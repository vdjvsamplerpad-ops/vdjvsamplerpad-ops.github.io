import * as React from 'react'
import { supabase } from '@/lib/supabase'
import type { User, AuthError, Session } from '@supabase/supabase-js'
import { clearUserBankCache, refreshAccessibleBanksCache } from '@/lib/bank-utils'
import {
  ensureActivityRuntime,
  SessionConflictError,
  checkSessionValidity,
  logSignoutActivity,
  sendActivityHeartbeat,
  sendHeartbeatBeacon,
} from '@/lib/activityLogger'

// Keys for localStorage caching
const USER_CACHE_KEY = 'vdjv-cached-user';
const PROFILE_CACHE_KEY = 'vdjv-cached-profile';
const BAN_CACHE_KEY = 'vdjv-cached-ban';
const OFFLINE_SIGNOUT_PENDING_KEY = 'vdjv-offline-signout-pending';
const SESSION_CONFLICT_REASON_KEY = 'vdjv-session-conflict-reason';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';

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
  sessionConflictReason: string | null
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
  signIn: (email: string, password: string) => Promise<{ error?: AuthError | null; data?: { user: User | null } }>
  signUp: (email: string, password: string, displayName: string) => Promise<{ error?: AuthError | null; data?: any }>
  signOut: () => Promise<{ error?: AuthError | null }>
  requestPasswordReset: (email: string) => Promise<{ error?: AuthError | null }>
  updatePassword: (newPassword: string) => Promise<{ error?: AuthError | null }>
  clearRedirectError: () => void
  clearSessionConflictReason: () => void
}

type AuthContextValue = AuthState & AuthActions
const AuthContext = React.createContext<AuthContextValue | null>(null)

const getPendingOfflineSignout = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OFFLINE_SIGNOUT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
};

const setPendingOfflineSignout = (pending: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (pending) localStorage.setItem(OFFLINE_SIGNOUT_PENDING_KEY, '1');
    else localStorage.removeItem(OFFLINE_SIGNOUT_PENDING_KEY);
  } catch (e) {
    console.warn('Failed to persist offline signout flag:', e);
  }
};

const getCachedSessionConflictReason = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(SESSION_CONFLICT_REASON_KEY);
  } catch {
    return null;
  }
};

const setCachedSessionConflictReason = (reason: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!reason) localStorage.removeItem(SESSION_CONFLICT_REASON_KEY);
    else localStorage.setItem(SESSION_CONFLICT_REASON_KEY, reason);
  } catch (e) {
    console.warn('Failed to persist session conflict reason:', e);
  }
};

const emitSessionEnforcementEvent = (reason: string): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_ENFORCEMENT_EVENT_KEY, JSON.stringify({ reason, ts: Date.now() }));
  } catch (e) {
    console.warn('Failed to emit session enforcement event:', e);
  }
};

const setHideProtectedBanksLock = (locked: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    if (locked) localStorage.setItem(HIDE_PROTECTED_BANKS_KEY, '1');
    else localStorage.removeItem(HIDE_PROTECTED_BANKS_KEY);
  } catch (e) {
    console.warn('Failed to persist protected bank visibility lock:', e);
  }
};

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

function isTransientNetworkError(
  error:
    | {
        message?: string | null
        status?: number
        code?: string | null
        name?: string | null
      }
    | null
    | undefined
): boolean {
  if (!error) return false
  if (error.status === 401 || error.status === 403) return false
  if (error.status === 0) return true
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true

  const haystack = `${error.name || ''} ${error.code || ''} ${error.message || ''}`.toLowerCase()
  return (
    haystack.includes('failed to fetch') ||
    haystack.includes('fetch failed') ||
    haystack.includes('networkerror') ||
    haystack.includes('network request failed') ||
    haystack.includes('load failed') ||
    haystack.includes('timeout') ||
    haystack.includes('aborterror')
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

function useAuthValue(): AuthState & AuthActions {
  const cachedBan = getCachedBan()
  const cachedUser = cachedBan ? null : getCachedUser()
  const cachedProfile = cachedBan ? null : getCachedProfile()

  const [state, setState] = React.useState<AuthState>({
    user: cachedUser,
    profile: cachedProfile,
    loading: true,
    isPasswordRecovery: false,
    redirectError: null,
    sessionConflictReason: getCachedSessionConflictReason(),
    banned: cachedBan,
  })
  
  // Track which user we've already refreshed cache for
  const cacheRefreshedForUserIdRef = React.useRef<string | null>(null)
  const sessionConflictLockedRef = React.useRef(false)

  React.useEffect(() => {
    ensureActivityRuntime()
  }, [])

  const setBannedState = React.useCallback((banned: boolean) => {
    cacheBanState(banned)
    setState((s) => (s.banned === banned ? s : { ...s, banned }))
  }, [])

  const setSessionConflictReason = React.useCallback((reason: string | null) => {
    setCachedSessionConflictReason(reason)
    setState((s) => (s.sessionConflictReason === reason ? s : { ...s, sessionConflictReason: reason }))
  }, [])

  const enforceBan = React.useCallback(async () => {
    cacheBanState(true)
    setHideProtectedBanksLock(true)
    cacheUserData(null, null)
    clearUserBankCache()
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

  const enforceSessionConflict = React.useCallback(async (reason?: string) => {
    if (sessionConflictLockedRef.current) return
    sessionConflictLockedRef.current = true
    const message = reason || 'This account was used on another device. You were signed out on this device.'
    const currentUser = state.user || getCachedUser()
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    setSessionConflictReason(message)
    emitSessionEnforcementEvent(message)
    cacheUserData(null, null)
    clearUserBankCache(currentUser?.id)
    cacheRefreshedForUserIdRef.current = null
    setState((s) => ({
      ...s,
      user: null,
      profile: null,
      loading: false,
      isPasswordRecovery: false,
    }))
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (err) {
      console.warn('Failed local signout after session conflict:', err)
    }
  }, [setSessionConflictReason, state.user])

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
      if (sessionConflictLockedRef.current) {
        cacheUserData(null, null)
        clearUserBankCache()
        cacheRefreshedForUserIdRef.current = null
        setState((s) => ({ ...s, user: null, profile: null, loading: false }))
        return
      }
      if (session?.user) {
        const { data: authData, error: authError } = await supabase.auth.getUser()
        const transientAuthError = isTransientNetworkError(authError)
        const fallbackCachedUser = getCachedUser() || session.user
        const authUser = authData?.user || (transientAuthError ? fallbackCachedUser : null)

        if (!authUser || authError?.status === 401 || authError?.status === 403) {
          cacheUserData(null, null)
          clearUserBankCache()
          cacheRefreshedForUserIdRef.current = null
          setState((s) => ({ ...s, user: null, profile: null, loading: false }))
          return
        }
        if (isUserBanned(authUser)) {
          await enforceBan()
          return
        }
        if (isBanError(authError)) {
          await enforceBan()
          return
        }
        if (authError) {
          if (transientAuthError) {
            console.warn('Using cached auth state due transient auth validation failure:', authError)
          } else {
            console.warn('Failed to validate auth user:', authError)
          }
        } else {
          setBannedState(false)
        }
        setHideProtectedBanksLock(false)
        setSessionConflictReason(null)

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .maybeSingle()

        if (error) {
          if (isTransientNetworkError(error)) {
            const fallbackProfile = getCachedProfile()
            cacheUserData(authUser, fallbackProfile)
            setState((s) => ({ ...s, user: authUser, profile: fallbackProfile, loading: false }))
          } else {
            console.warn('Profile lookup failed, clearing local auth state:', error)
            cacheUserData(null, null)
            clearUserBankCache()
            cacheRefreshedForUserIdRef.current = null
            setState((s) => ({ ...s, user: null, profile: null, loading: false }))
          }
        } else {
          const resolvedProfile = profile ? (profile as Profile) : await ensureProfile(authUser)
          cacheUserData(authUser, resolvedProfile)
          setState((s) => ({ ...s, user: authUser, profile: resolvedProfile, loading: false }))
        }
        
        // Refresh accessible banks cache ONLY once per user session (not on every auth state change)
        if (cacheRefreshedForUserIdRef.current !== authUser.id) {
          cacheRefreshedForUserIdRef.current = authUser.id
          refreshAccessibleBanksCache(authUser.id).catch(console.warn)
        }
      } else {
        cacheUserData(null, null)
        setHideProtectedBanksLock(true)
        clearUserBankCache()
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
  }, [ensureProfile, enforceBan, setBannedState, setSessionConflictReason])

  React.useEffect(() => {
    if (!state.user || state.banned) return

    const heartbeat = () => {
      void sendActivityHeartbeat({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'heartbeat',
        meta: {
          visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
        },
      }).catch((err) => {
        if (err instanceof SessionConflictError) {
          void enforceSessionConflict(err.message)
          return
        }
        const message = String((err as any)?.message || err || '')
        const transientNetworkError =
          message.includes('Failed to fetch') ||
          message.includes('NetworkError') ||
          message.includes('Load failed') ||
          message.includes('TypeError: Failed to fetch')
        if (!transientNetworkError) {
          console.warn('Heartbeat failed:', err)
        }
      })
    }

    void checkSessionValidity({
      userId: state.user!.id,
      email: state.user!.email || null,
      lastEvent: 'startup-check',
      meta: { visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown' },
    }).catch((err) => {
      if (err instanceof SessionConflictError) {
        void enforceSessionConflict(err.message)
      }
    })
    heartbeat()
    const interval = window.setInterval(heartbeat, 60_000)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      heartbeat()
      void checkSessionValidity({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'visibility-check',
        meta: { visibility: document.visibilityState },
      }).catch((err) => {
        if (err instanceof SessionConflictError) {
          void enforceSessionConflict(err.message)
        }
      })
    }
    const onPageHide = () => {
      sendHeartbeatBeacon({
        userId: state.user?.id,
        email: state.user?.email || null,
        lastEvent: 'pagehide',
        meta: { visibility: document.visibilityState },
      })
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onPageHide)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
    }
  }, [state.user?.id, state.user?.email, state.banned, enforceSessionConflict])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    const onOnline = () => {
      void checkSessionValidity({
        userId: state.user!.id,
        email: state.user!.email || null,
        lastEvent: 'reconnect-check',
        meta: { visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown' },
      }).catch((err) => {
        if (err instanceof SessionConflictError) {
          void enforceSessionConflict(err.message)
        }
      })
      refreshAccessibleBanksCache(state.user!.id).catch(console.warn)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [state.user?.id, state.user?.email, state.banned, enforceSessionConflict])

  React.useEffect(() => {
    if (!state.user || state.banned) return
    if (!getPendingOfflineSignout()) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    const currentUser = state.user
    const finalizeDeferredSignout = async () => {
      const { error } = await supabase.auth.signOut()
      cacheUserData(null, null)
      setHideProtectedBanksLock(true)
      clearUserBankCache(currentUser.id)
      setPendingOfflineSignout(false)
      setState((s) => ({ ...s, user: null, profile: null, loading: false }))
      void logSignoutActivity({
        status: error ? 'failed' : 'success',
        userId: currentUser.id,
        email: currentUser.email || null,
        errorMessage: error?.message || null,
        meta: {
          source: 'useAuth.signOut.offline-finalize',
        },
      }).catch((err) => {
        console.warn('Failed to log deferred signout activity:', err)
      })
      emitSessionEnforcementEvent('deferred-signout-finalized')
    }

    void finalizeDeferredSignout()
  }, [state.user?.id, state.banned])

  const signIn = React.useCallback(async (email: string, password: string) => {
    setSessionConflictReason(null)
    sessionConflictLockedRef.current = false
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data?.user) {
      setHideProtectedBanksLock(false)
    }
    if (isBanError(error)) {
      await enforceBan()
    }
    return { error, data: { user: data.user } }
  }, [enforceBan, setSessionConflictReason])

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
    const activeUser = state.user || getCachedUser()
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setPendingOfflineSignout(true)
      setHideProtectedBanksLock(true)
      void logSignoutActivity({
        status: 'success',
        userId: activeUser?.id || null,
        email: activeUser?.email || null,
        meta: {
          source: 'useAuth.signOut.offline-deferred',
          deferred: true,
        },
      }).catch((err) => {
        console.warn('Failed to queue deferred signout activity:', err)
      })
      return { error: null }
    }
    const { error } = await supabase.auth.signOut()
    setPendingOfflineSignout(false)
    setHideProtectedBanksLock(true)
    // Clear cached user data on sign out
    cacheUserData(null, null)
    clearUserBankCache(activeUser?.id)
    void logSignoutActivity({
      status: error ? 'failed' : 'success',
      userId: activeUser?.id || null,
      email: activeUser?.email || null,
      errorMessage: error?.message || null,
      meta: {
        source: 'useAuth.signOut',
      },
    }).catch((err) => {
      console.warn('Failed to log signout activity:', err)
    })
    return { error }
  }, [state.user])

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

  const clearSessionConflictReason = React.useCallback(() => {
    setSessionConflictReason(null)
  }, [setSessionConflictReason])

  return {
    ...state,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    updatePassword,
    clearRedirectError,
    clearSessionConflictReason,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useAuthValue()
  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
