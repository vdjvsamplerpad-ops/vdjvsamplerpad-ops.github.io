import { edgeFunctionUrl, getAuthHeaders } from '@/lib/edge-api';

export type SortDirection = 'asc' | 'desc';

export interface AdminUser {
  id: string;
  email: string | null;
  role: 'admin' | 'user';
  display_name: string;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  is_banned: boolean;
}

export interface AdminBank {
  id: string;
  title: string;
  description: string;
  color?: string | null;
  created_at: string | null;
  created_by: string | null;
  access_count: number;
}

export interface AccessEntry {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
  bank: {
    id: string;
    title: string;
    description?: string | null;
  } | null;
}

export interface ActiveSessionRow {
  session_key: string;
  user_id: string;
  email?: string | null;
  device_fingerprint: string;
  device_name?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  last_seen_at: string;
}

const toQueryString = (params: Record<string, string | number | boolean | null | undefined>) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : '';
};

const callAdmin = async <T>(method: 'GET' | 'POST', route: string, body?: unknown): Promise<T> => {
  const headers = await getAuthHeaders(true);
  const resp = await fetch(edgeFunctionUrl('admin-api', route), {
    method,
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await resp.json().catch(() => ({}));
  const err = payload?.error || payload?.data?.error;
  if (!resp.ok || payload?.ok === false) {
    throw new Error(err || 'Admin API request failed');
  }

  return ((payload?.data ?? payload) as T);
};

export const adminApi = {
  async listUsers(input: {
    q?: string;
    page?: number;
    perPage?: number;
    sortBy?: 'display_name' | 'email' | 'created_at' | 'last_sign_in_at' | 'ban_status';
    sortDir?: SortDirection;
    includeAdmins?: boolean;
  }) {
    const query = toQueryString({
      q: input.q,
      page: input.page ?? 1,
      perPage: input.perPage ?? 1000,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
      includeAdmins: input.includeAdmins ?? false,
    });
    return callAdmin<{ users: AdminUser[]; total: number }>('GET', `users${query}`);
  },

  async createUser(input: { email: string; password: string; displayName?: string }) {
    return callAdmin<{ user: AdminUser }>('POST', 'users/create', input);
  },

  async updateUserProfile(userId: string, input: { displayName: string }) {
    return callAdmin<{ user: AdminUser }>('POST', `users/${userId}/update-profile`, input);
  },

  async deleteUser(userId: string) {
    return callAdmin<{ userId: string }>('POST', `users/${userId}/delete`);
  },

  async banUser(userId: string, hours: number) {
    return callAdmin<{ userId: string; banned_until: string }>('POST', `users/${userId}/ban`, { hours });
  },

  async unbanUser(userId: string) {
    return callAdmin<{ userId: string; banned_until: null }>('POST', `users/${userId}/unban`);
  },

  async resetPassword(userId: string) {
    return callAdmin<{ userId: string; email: string }>('POST', `users/${userId}/reset-password`);
  },

  async listBanks(input: {
    q?: string;
    sortBy?: 'title' | 'created_at' | 'access_count';
    sortDir?: SortDirection;
  }) {
    const query = toQueryString({
      q: input.q,
      sortBy: input.sortBy ?? 'created_at',
      sortDir: input.sortDir ?? 'desc',
    });
    return callAdmin<{ banks: AdminBank[]; total: number }>('GET', `banks${query}`);
  },

  async updateBank(bankId: string, input: { title: string; description?: string; color?: string | null }) {
    return callAdmin<{ bank: AdminBank }>('POST', `banks/${bankId}/update`, input);
  },

  async deleteBank(bankId: string, revokeAll = true) {
    return callAdmin<{ bankId: string; revokedAll: boolean }>('POST', `banks/${bankId}/delete`, { revokeAll });
  },

  async getUserAccess(userId: string) {
    return callAdmin<{ userId: string; bankIds: string[]; access: AccessEntry[] }>('GET', `access/user/${userId}`);
  },

  async grantUserAccess(userId: string, bankIds: string[]) {
    return callAdmin<{ userId: string; bankIds: string[]; grantedCount: number }>('POST', `access/user/${userId}/grant`, { bankIds });
  },

  async revokeUserAccess(userId: string, bankIds: string[]) {
    return callAdmin<{ userId: string; bankIds: string[]; revokedCount: number }>('POST', `access/user/${userId}/revoke`, { bankIds });
  },

  async listActiveSessions(input: { q?: string; limit?: number }) {
    const query = toQueryString({
      q: input.q,
      limit: input.limit ?? 300,
      t: Date.now(),
    });
    return callAdmin<{ counts: { activeUsers: number; activeSessions: number }; sessions: ActiveSessionRow[]; total: number }>(
      'GET',
      `active-sessions${query}`,
    );
  },
};
