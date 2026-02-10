import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { User, AuthError, Session } from '@supabase/supabase-js'
import { refreshAccessibleBanksCache } from '@/lib/bank-utils'

// Keys for localStorage caching
const USER_CACHE_KEY = 'vdjv-cached-user';
const PROFILE_CACHE_KEY = 'vdjv-cached-profile';
const BAN_CACHE_KEY = 'vdjv-cached-ban';

export interface Profile {
  id: string
  role: 'admin' | 'user'
  display_name: string
}

interface AuthState {
  user: User | null
  profile: Profile | null
  loading: boolean
  isPasswordRecovery: boolean
  redirectError: { code: string; description: string } | null
  banned: boolean
}

// Helper to get cached user from localStorage (for offline/sync issues)
export function getCachedUser(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(USER_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper to get cached profile from localStorage
export function getCachedProfile(): Profile | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
}

// Helper to get cached ban flag from localStorage
export function getCachedBan(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const cached = localStorage.getItem(BAN_CACHE_KEY);
    return cached === '1' || cached === 'true';
  } catch {
    return false;
  }
}

// Helper to cache user data
function cacheUserData(user: User | null, profile: Profile | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
    if (profile) {
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    } else {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    }
  } catch (e) {
    console.warn('Failed to cache user data:', e);
  }
}

function cacheBanState(banned: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (banned) {
      localStorage.setItem(BAN_CACHE_KEY, '1');
    } else {
      localStorage.removeItem(BAN_CACHE_KEY);
    }
  } catch (e) {
    console.warn('Failed to cache ban state:', e);
  }
}

interface AuthActions {
  signIn: (email: string, password: string) => Promise<{ error?: AuthError | null }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error?: AuthError | null; data?: any }>
  signOut: () => Promise<{ error?: AuthError | null }>
  requestPasswordReset: (email: string) => Promise<{ error?: AuthError | null }>
  updatePassword: (newPassword: string) => Promise<{ error?: AuthError | null }>
  clearRedirectError: () => void
}

function parseHashParams(hash: string): Record<string, string> {
  const raw = hash.replace(/^#/, '')
  const params = new URLSearchParams(raw)
  const out: Record<string, string> = {}
  params.forEach((v, k) => (out[k] = v))
  return out
}

function isBanError(error: { message?: string | null; status?: number; code?: string | null } | null | undefined): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  const code = (error.code || '').toLowerCase()
  const status = error.status
  return (
    message.includes('banned') ||
    message.includes('ban') ||
    message.includes('suspended') ||
    code.includes('banned') ||
    code.includes('suspended') ||
    status === 403
  )
}

function isUserBanned(user: User | null): boolean {
  if (!user) return false
  const bannedUntil =
    (user as any).banned_until ||
    (user as any).app_metadata?.banned_until ||
    (user as any).user_metadata?.banned_until
  if (!bannedUntil) return false
  const banDate = new Date(bannedUntil)
  return !Number.isNaN(banDate.getTime()) && banDate > new Date()
}

export function useAuth(): AuthState & AuthActions {
  const [state, setState] = React.useState<AuthState>({
    user: null,
    profile: null,
    loading: true,
    isPasswordRecovery: false,
    redirectError: null,
    banned: getCachedBan(),
  })
  
  // Track which user we've already refreshed cache for
  const cacheRefreshedForUserIdRef = React.useRef<string | null>(null)

  const setBannedState = React.useCallback((banned: boolean) => {
    cacheBanState(banned)
    setState((s) => (s.banned === banned ? s : { ...s, banned }))
  }, [])

  const enforceBan = React.useCallback(async () => {
    cacheBanState(true)
    cacheUserData(null, null)
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      isPasswordRecovery: false,
      banned: true,
    }))
    try {
      await supabase.auth.signOut({ scope: 'global' })
    } catch (err) {
      console.warn('Failed to sign out banned user:', err)
    }
  }, [])

  const ensureProfile = React.useCallback(async (user: User) => {
    const { data: existing, error: selectErr } = await supabase
      .from('profiles')
      .select('id, display_name, role')
      .eq('id', user.id)
      .maybeSingle()

    if (selectErr) {
      console.error('Error checking profile:', selectErr)
      return null
    }
    if (existing) return existing as Profile

    const displayName =
      (user.user_metadata?.display_name as string | undefined) ||
      user.email?.split('@')[0] ||
      'User'

    const { data: created, error: upsertErr } = await supabase
      .from('profiles')
      .upsert({ id: user.id, display_name: displayName, role: 'user' }, { onConflict: 'id' })
      .select('*')
      .single()

    if (upsertErr) {
      console.error('Error creating profile:', upsertErr)
      return null
    }
    return created as Profile
  }, [])

  React.useEffect(() => {
    if (getCachedBan()) {
      supabase.auth.signOut({ scope: 'global' }).catch((err) => {
        console.warn('Failed to sign out banned user:', err)
      })
    }

    // 1) Parse URL hash for redirect errors (e.g., otp_expired)
    if (typeof window !== 'undefined' && window.location.hash) {
      const params = parseHashParams(window.location.hash)
      const error = params['error']
      const error_code = params['error_code']
      const error_description = params['error_description']
      if (error || error_code) {
        setState((s) => ({
          ...s,
          redirectError: {
            code: error_code || error || 'unknown_error',
            description: decodeURIComponent(error_description || 'There was a problem handling the link.'),
          },
        }))
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }

    // 2) Session/profile
    const fetchSessionAndProfile = async (session: Session | null) => {
      if (session?.user) {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        const authUser = authData?.user || session.user
        if (isUserBanned(authUser)) {
          await enforceBan()
          return
        }
        if (isBanError(authError)) {
          await enforceBan()
          return
        }
        if (authError) {
          console.warn('Failed to validate auth user:', authError)
        } else {
          setBannedState(false)
        }

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (error) {
          const created = await ensureProfile(session.user)
          cacheUserData(session.user, created)
          setState((s) => ({ ...s, user: session.user, profile: created, loading: false }))
        } else {
          cacheUserData(session.user, profile as Profile)
          setState((s) => ({ ...s, user: session.user, profile: profile as Profile, loading: false }))
        }
        
        // Refresh accessible banks cache ONLY once per user session (not on every auth state change)
        if (cacheRefreshedForUserIdRef.current !== session.user.id) {
          cacheRefreshedForUserIdRef.current = session.user.id
          refreshAccessibleBanksCache(session.user.id).catch(console.warn)
        }
      } else {
        cacheUserData(null, null)
        cacheRefreshedForUserIdRef.current = null
        setState((s) => ({ ...s, user: null, profile: null, loading: false }))
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      fetchSessionAndProfile(session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const isRecovery = event === 'PASSWORD_RECOVERY'
      setState((s) => ({ ...s, isPasswordRecovery: isRecovery }))
      fetchSessionAndProfile(session)
    })

    return () => subscription.unsubscribe()
  }, [ensureProfile, enforceBan, setBannedState])

  const signIn = React.useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (isBanError(error)) {
      await enforceBan()
    }
    return { error }
  }, [enforceBan])

  const signUp = React.useCallback(async (email: string, password: string, displayName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
      },
    })
    return { error, data }
  }, [])

  const signOut = React.useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    // Clear cached user data on sign out
    cacheUserData(null, null)
    return { error }
  }, [])

  const requestPasswordReset = React.useCallback(async (email: string) => {
    try {
      // Check if a recent reset was already sent (within last 5 minutes)
      const recentResetKey = `password_reset_${email}`
      const lastResetTime = localStorage.getItem(recentResetKey)
      const now = Date.now()
      const fiveMinutes = 5 * 60 * 1000 // 5 minutes in milliseconds

      if (lastResetTime && (now - parseInt(lastResetTime)) < fiveMinutes) {
        const remainingTime = Math.ceil((fiveMinutes - (now - parseInt(lastResetTime))) / 1000 / 60)
        return { 
          error: { 
            message: `Please wait ${remainingTime} minute${remainingTime > 1 ? 's' : ''} before requesting another reset.` 
          } as AuthError 
        }
      }

      // Store the reset request time first
      localStorage.setItem(recentResetKey, now.toString())

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
      })

      if (error) {
        // Remove the stored time if the request failed
        localStorage.removeItem(recentResetKey)
        
        // Handle specific Supabase error messages
        if (error.message.includes('User not found') || 
            error.message.includes('No user found') ||
            error.message.includes('Invalid email')) {
          return { error: { message: 'No account found with this email address.' } as AuthError }
        }
        
        return { error }
      }

      return { error: null }
    } catch (error) {
      console.error('Password reset error:', error)
      return { error: { message: 'Failed to send reset email. Please try again.' } as AuthError }
    }
  }, [])

  const updatePassword = React.useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) {
      setState((s) => ({ ...s, isPasswordRecovery: false }))
    }
    return { error }
  }, [])

  const clearRedirectError = React.useCallback(() => {
    setState((s) => ({ ...s, redirectError: null }))
  }, [])

  return {
    ...state,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    clearRedirectError,
  }
}
