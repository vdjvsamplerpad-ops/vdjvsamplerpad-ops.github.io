import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'

interface LoginModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  theme?: 'light' | 'dark'
  appReturnUrl?: string
  /** Slide-down notification pusher from HeaderControls */
  pushNotice?: (opts: { variant: 'success' | 'error' | 'info'; message: string }) => void
}

type Mode = 'signin' | 'signup' | 'forgot' | 'reset'

function normalizeAuthErrorMessage(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (m.includes('invalid login') || m.includes('invalid email or password') || m.includes('invalid credentials')) {
    return 'Invalid login credentials.'
  }
  if (m.includes('email') && m.includes('invalid')) return 'Email address is invalid.'
  if (m.includes('already registered') || m.includes('already exists')) return 'This email is already registered.'
  if (m.includes('rate limit')) return 'Too many attempts. Please try again later.'
  if (m.includes('no account found') || m.includes('user not found') || m.includes('no user found')) return 'No account found with this email address.'
  if (m.includes('please wait') && m.includes('minute')) return msg // Keep the specific wait time message
  if (m.includes('unable to verify email')) return 'Unable to verify email. Please try again.'
  return msg || 'Something went wrong. Please try again.'
}

export function LoginModal({ open, onOpenChange, theme = 'light', appReturnUrl, pushNotice }: LoginModalProps) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [displayName, setDisplayName] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [mode, setMode] = React.useState<Mode>('signin')
  const [loading, setLoading] = React.useState(false)
  const [resetCooldown, setResetCooldown] = React.useState<number>(0)

  const {
    signIn,
    signUp,
    requestPasswordReset,
    updatePassword,
    isPasswordRecovery,
    redirectError,
    clearRedirectError,
  } = useAuth()

  const colorText = theme === 'dark' ? 'text-white' : 'text-gray-900'
  const panelClass = `sm:max-w-md ${theme === 'dark' ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`

  // Reset fields when modal closes
  React.useEffect(() => {
    if (!open) {
      setEmail('')
      setPassword('')
      setDisplayName('')
      setConfirmPassword('')
      setMode('signin')
      setResetCooldown(0)
      if (redirectError) clearRedirectError()
    }
  }, [open, redirectError, clearRedirectError])

  // Check for existing reset cooldown when modal opens
  React.useEffect(() => {
    if (open && email) {
      const recentResetKey = `password_reset_${email}`
      const lastResetTime = localStorage.getItem(recentResetKey)
      if (lastResetTime) {
        const now = Date.now()
        const fiveMinutes = 5 * 60 * 1000
        const timeRemaining = Math.max(0, fiveMinutes - (now - parseInt(lastResetTime)))
        if (timeRemaining > 0) {
          setResetCooldown(Math.ceil(timeRemaining / 1000 / 60))
        }
      }
    }
  }, [open, email])

  // Countdown timer for reset cooldown
  React.useEffect(() => {
    if (resetCooldown > 0) {
      const timer = setTimeout(() => {
        setResetCooldown(prev => Math.max(0, prev - 1))
      }, 60000) // Update every minute
      return () => clearTimeout(timer)
    }
  }, [resetCooldown])

  // Handle password recovery landing (from email link)
  React.useEffect(() => {
    if (isPasswordRecovery) {
      setMode('reset')
      if (!open) onOpenChange(true)
      // Show helper notice to the user
      pushNotice?.({ variant: 'info', message: 'Ready to set a new password.' })
    }
  }, [isPasswordRecovery, onOpenChange, open, pushNotice])

  // Handle redirect error (e.g., otp_expired)
  React.useEffect(() => {
    if (redirectError) {
      if (!open) onOpenChange(true)
      pushNotice?.({
        variant: 'error',
        message:
          redirectError.code === 'otp_expired'
            ? 'Reset link expired. Request a new one.'
            : redirectError.description || 'Authentication error.',
      })
      setMode('forgot')
      clearRedirectError()
    }
  }, [redirectError, onOpenChange, open, clearRedirectError, pushNotice])

  // Helper: extra landing tab message (close/return)
  const RecoveryLandingHelper = () =>
    isPasswordRecovery ? (
      <div className="p-3 rounded-lg text-xs bg-yellow-50 border border-yellow-200 text-yellow-700 mb-3">
        If you opened this from your email in a separate tab, your app may already be ready to reset in another tab.{' '}
        <button
          type="button"
          onClick={() => {
            try { window.close() } catch { }
          }}
          className="underline"
        >
          Close this tab
        </button>
        {appReturnUrl && (
          <>
            {' · '}
            <a className="underline" href={appReturnUrl}>Return to the app</a>
          </>
        )}
      </div>
    ) : null

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'signup') {
        if (password !== confirmPassword) {
          pushNotice?.({ variant: 'error', message: 'Passwords do not match.' })
          return
        }
        if (!displayName) {
          pushNotice?.({ variant: 'error', message: 'Display name is required.' })
          return
        }
        const { error, data } = await signUp(email, password, displayName)

        // Heuristic: if identities array is empty, the email is already registered (Supabase quirk)
        const alreadyExists = data?.user && Array.isArray((data.user as any).identities) && (data.user as any).identities.length === 0

        if (error || alreadyExists) {
          const msg = normalizeAuthErrorMessage(error?.message || 'This email is already registered.')
          pushNotice?.({ variant: 'error', message: msg })
          return
        }

        // Success: tell them to check email
        pushNotice?.({ variant: 'success', message: 'Sign up successful. Check your email for a confirmation link.' })
        // Stay open so they can read? Your call. We’ll just switch to Sign In.
        setMode('signin')
        setPassword('')
        setConfirmPassword('')
        return
      }

      // Sign in
      const { error } = await signIn(email, password)
      if (error) {
        pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
      } else {
        pushNotice?.({ variant: 'success', message: 'Logged in successfully.' })
        onOpenChange(false)
      }
    } catch {
      pushNotice?.({ variant: 'error', message: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) {
      pushNotice?.({ variant: 'error', message: 'Please enter your email.' })
      return
    }
    setLoading(true)
    try {
      const { error } = await requestPasswordReset(email)
      if (error) {
        pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
        
        // If it's a cooldown error, extract the time and set it
        if (error.message.includes('Please wait')) {
          const match = error.message.match(/(\d+)/)
          if (match) {
            setResetCooldown(parseInt(match[1]))
          }
        }
      } else {
        pushNotice?.({ variant: 'success', message: 'Password reset link sent. Check your email.' })
        setMode('signin')
        setResetCooldown(5) // Set 5 minute cooldown
      }
    } catch {
      pushNotice?.({ variant: 'error', message: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      pushNotice?.({ variant: 'error', message: 'Password must be at least 6 characters.' })
      return
    }
    if (password !== confirmPassword) {
      pushNotice?.({ variant: 'error', message: 'Passwords do not match.' })
      return
    }
    setLoading(true)
    try {
      const { error } = await updatePassword(password)
      if (error) {
        pushNotice?.({ variant: 'error', message: normalizeAuthErrorMessage(error.message) })
      } else {
        // Auto-close after success (per your request)
        onOpenChange(false)
        // Optional: also show a subtle success toast
        pushNotice?.({ variant: 'success', message: 'Password updated.' })
      }
    } catch {
      pushNotice?.({ variant: 'error', message: 'Something went wrong. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const Title = () => {
    switch (mode) {
      case 'signup': return <>Create Account</>
      case 'forgot': return <>Forgot Password</>
      case 'reset': return <>Reset Password</>
      default: return <>Sign In</>
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={panelClass} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className={colorText}><Title /></DialogTitle>
        </DialogHeader>

        <DialogDescription className="sr-only">
          {mode === 'signin' && 'Sign in to your account.'}
          {mode === 'signup' && 'Create a new account.'}
          {mode === 'forgot' && 'Request a password reset link via email.'}
          {mode === 'reset' && 'Choose a new password for your account.'}
        </DialogDescription>

        <RecoveryLandingHelper />

        {/* RESET MODE */}
        {mode === 'reset' ? (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className={colorText}>New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a new password"
                required
                disabled={loading}
                minLength={8}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmNewPassword" className={colorText}>Confirm New Password</Label>
              <Input
                id="confirmNewPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your new password"
                required
                disabled={loading}
                minLength={8}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Button type="submit" className="w-full" disabled={loading || !password || !confirmPassword}>
                {loading ? 'Updating...' : 'Update Password'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => { setMode('signin'); }}
                disabled={loading}
              >
                Back to Sign In
              </Button>
            </div>
          </form>
        ) : null}

        {/* FORGOT MODE */}
        {mode === 'forgot' ? (
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className={colorText}>Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled={loading}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>
            
            {resetCooldown > 0 && (
              <div className="p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm">
                Please wait {resetCooldown} minute{resetCooldown > 1 ? 's' : ''} before requesting another reset.
              </div>
            )}
            
            <div className="space-y-2">
              <Button 
                type="submit" 
                className="w-full" 
                disabled={loading || !email || resetCooldown > 0}
              >
                {loading ? 'Sending...' : 'Send reset link'}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => { setMode('signin'); }}
                disabled={loading}
              >
                Back to Sign In
              </Button>
            </div>
          </form>
        ) : null}

        {/* SIGNIN / SIGNUP MODES */}
        {(mode === 'signin' || mode === 'signup') && (
          <form onSubmit={handleSubmitAuth} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="displayName" className={colorText}>Display Name</Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                  required
                  disabled={loading}
                  autoComplete="name"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  onFocus={(e) => {
                    // Prevent immediate focus on mobile
                    if (window.innerWidth <= 768) {
                      setTimeout(() => e.target.focus(), 100);
                    }
                  }}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className={colorText}>Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                disabled={loading}
                autoComplete="email"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className={colorText}>Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={loading}
                minLength={6}
                autoComplete="current-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
                onFocus={(e) => {
                  // Prevent immediate focus on mobile
                  if (window.innerWidth <= 768) {
                    setTimeout(() => e.target.focus(), 100);
                  }
                }}
              />
            </div>

            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className={colorText}>Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                  disabled={loading}
                  minLength={6}
                  autoComplete="new-password"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  onFocus={(e) => {
                    // Prevent immediate focus on mobile
                    if (window.innerWidth <= 768) {
                      setTimeout(() => e.target.focus(), 100);
                    }
                  }}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="link"
                className="px-0 text-sm"
                onClick={() => { setMode(mode === 'signin' ? 'forgot' : 'signin') }}
                disabled={loading}
              >
                Forgot password?
              </Button>

              <Button
                type="button"
                variant="link"
                className="px-0 text-sm"
                onClick={() => {
                  const next = mode === 'signup' ? 'signin' : 'signup'
                  setMode(next as Mode)
                }}
                disabled={loading}
              >
                {mode === 'signup' ? 'Already have an account? Sign In' : 'Need an account? Sign Up'}
              </Button>
            </div>

            <div className="space-y-2">
              <Button
                type="submit"
                className="w-full"
                disabled={
                  loading ||
                  !email ||
                  !password ||
                  (mode === 'signup' && (!displayName || !confirmPassword))
                }
              >
                {loading ? 'Loading...' : (mode === 'signup' ? 'Create Account' : 'Sign In')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
