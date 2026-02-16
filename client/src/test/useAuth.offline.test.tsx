import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkSessionValidityMock = vi.fn();
const clearUserBankCacheMock = vi.fn();
const refreshAccessibleBanksCacheMock = vi.fn();

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();
const getUserMock = vi.fn();
const signOutMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const signUpMock = vi.fn();
const resetPasswordForEmailMock = vi.fn();
const updateUserMock = vi.fn();

const profileMaybeSingleMock = vi.fn();
const profileUpsertSingleMock = vi.fn();

const unsubscribeMock = vi.fn();
let authStateChangeHandler: ((event: string, session: { user: TestUser } | null) => void) | null = null;

vi.mock('@/lib/bank-utils', () => ({
  clearUserBankCache: (...args: unknown[]) => clearUserBankCacheMock(...args),
  refreshAccessibleBanksCache: (...args: unknown[]) => refreshAccessibleBanksCacheMock(...args),
}));

vi.mock('@/lib/activityLogger', () => {
  class SessionConflictError extends Error {
    readonly code = 'SESSION_CONFLICT';
    constructor(message = 'Session conflict detected.') {
      super(message);
      this.name = 'SessionConflictError';
    }
  }

  return {
    SessionConflictError,
    ensureActivityRuntime: vi.fn(),
    checkSessionValidity: (...args: unknown[]) => checkSessionValidityMock(...args),
    logSignoutActivity: vi.fn().mockResolvedValue(undefined),
    sendActivityHeartbeat: vi.fn().mockResolvedValue(undefined),
    sendHeartbeatBeacon: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
      getUser: (...args: unknown[]) => getUserMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      signUp: (...args: unknown[]) => signUpMock(...args),
      resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmailMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
    from: (table: string) => {
      if (table !== 'profiles') {
        throw new Error(`Unexpected table in test: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: (...args: unknown[]) => profileMaybeSingleMock(...args),
          }),
        }),
        upsert: () => ({
          select: () => ({
            single: (...args: unknown[]) => profileUpsertSingleMock(...args),
          }),
        }),
      };
    },
  },
}));

import { SessionConflictError } from '@/lib/activityLogger';
import { AuthProvider, useAuth } from '@/hooks/useAuth';

const USER_CACHE_KEY = 'vdjv-cached-user';
const PROFILE_CACHE_KEY = 'vdjv-cached-profile';
const OFFLINE_SIGNOUT_PENDING_KEY = 'vdjv-offline-signout-pending';

type TestUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

const makeUser = (id = 'user-1'): TestUser => ({
  id,
  email: `${id}@example.com`,
  user_metadata: { display_name: 'DJ User' },
  app_metadata: {},
});

const makeProfile = (id = 'user-1') => ({
  id,
  display_name: 'DJ User',
  role: 'user' as const,
});

const createStorageMock = () => {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    clear: vi.fn(() => {
      map.clear();
    }),
    dump: () => map,
  };
};

function AuthProbe() {
  const auth = useAuth();
  return (
    <div>
      <div data-testid="loading">{auth.loading ? 'loading' : 'ready'}</div>
      <div data-testid="user-id">{auth.user?.id ?? 'none'}</div>
      <div data-testid="profile-name">{auth.profile?.display_name ?? 'none'}</div>
    </div>
  );
}

function AuthSignOutProbe() {
  const auth = useAuth();
  return (
    <div>
      <button type="button" onClick={() => void auth.signOut()}>
        signout
      </button>
      <div data-testid="user-id">{auth.user?.id ?? 'none'}</div>
    </div>
  );
}

describe('useAuth offline + session conflict behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unsubscribeMock.mockReset();

    const storage = createStorageMock();
    Object.defineProperty(window, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });

    Object.defineProperty(window.navigator, 'onLine', {
      value: true,
      configurable: true,
    });

    authStateChangeHandler = null;
    onAuthStateChangeMock.mockImplementation((handler: typeof authStateChangeHandler) => {
      authStateChangeHandler = handler;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    });
    refreshAccessibleBanksCacheMock.mockResolvedValue(undefined);
    checkSessionValidityMock.mockResolvedValue(undefined);
    signOutMock.mockResolvedValue({ error: null });
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: null });
    signUpMock.mockResolvedValue({ data: null, error: null });
    resetPasswordForEmailMock.mockResolvedValue({ error: null });
    updateUserMock.mockResolvedValue({ error: null });
    profileUpsertSingleMock.mockResolvedValue({ data: makeProfile(), error: null });
  });

  it('keeps user signed in during transient auth+profile network failures', async () => {
    const user = makeUser();
    const profile = makeProfile();
    window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { status: 0, message: 'TypeError: Failed to fetch', code: '' },
    });
    profileMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { status: 0, message: 'NetworkError when attempting to fetch resource.' },
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('ready');
      expect(screen.getByTestId('user-id').textContent).toBe(user.id);
      expect(screen.getByTestId('profile-name').textContent).toBe('DJ User');
    });
  });

  it('clears auth state on definitive 401 auth failure', async () => {
    const user = makeUser();
    window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));

    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { status: 401, message: 'Unauthorized' },
    });
    profileMaybeSingleMock.mockResolvedValue({ data: makeProfile(), error: null });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('ready');
      expect(screen.getByTestId('user-id').textContent).toBe('none');
    });
    expect(clearUserBankCacheMock).toHaveBeenCalled();
  });

  it('runs immediate reconnect session-check on online event', async () => {
    const user = makeUser();
    const profile = makeProfile();
    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({ data: { user }, error: null });
    profileMaybeSingleMock.mockResolvedValue({ data: profile, error: null });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe(user.id));

    checkSessionValidityMock.mockClear();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(checkSessionValidityMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, lastEvent: 'reconnect-check' })
      );
    });
  });

  it('enforces logout when reconnect check reports session conflict', async () => {
    const user = makeUser();
    const profile = makeProfile();
    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({ data: { user }, error: null });
    profileMaybeSingleMock.mockResolvedValue({ data: profile, error: null });

    checkSessionValidityMock.mockImplementation((payload: { lastEvent?: string }) => {
      if (payload?.lastEvent === 'reconnect-check') {
        return Promise.reject(new SessionConflictError('conflict'));
      }
      return Promise.resolve(undefined);
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe(user.id));

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('user-id').textContent).toBe('none');
    });
    expect(clearUserBankCacheMock).toHaveBeenCalledWith(user.id);
  });

  it('keeps user signed in on mid-session offline network drop', async () => {
    const user = makeUser();
    const profile = makeProfile();
    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({ data: { user }, error: null });
    profileMaybeSingleMock.mockResolvedValue({ data: profile, error: null });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe(user.id));

    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: { status: 0, message: 'Failed to fetch' },
    });
    profileMaybeSingleMock.mockResolvedValue({
      data: null,
      error: { status: 0, message: 'NetworkError' },
    });

    await act(async () => {
      authStateChangeHandler?.('TOKEN_REFRESHED', { user });
    });

    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe(user.id));
  });

  it('keeps deferred offline signout behavior unchanged', async () => {
    const user = makeUser();
    const profile = makeProfile();
    getSessionMock.mockResolvedValue({ data: { session: { user } } });
    getUserMock.mockResolvedValue({ data: { user }, error: null });
    profileMaybeSingleMock.mockResolvedValue({ data: profile, error: null });

    render(
      <AuthProvider>
        <AuthSignOutProbe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('user-id').textContent).toBe(user.id));

    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'signout' }));

    await waitFor(() => {
      expect(signOutMock).not.toHaveBeenCalled();
      expect(window.localStorage.setItem).toHaveBeenCalledWith(OFFLINE_SIGNOUT_PENDING_KEY, '1');
      expect(screen.getByTestId('user-id').textContent).toBe(user.id);
    });
  });
});
