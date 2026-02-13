import * as React from 'react';
import { createPortal } from 'react-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { adminApi, type AccessEntry, type ActiveSessionRow, type AdminBank, type AdminUser, type SortDirection } from '@/lib/admin-api';
import { LED_COLOR_PALETTE } from '@/lib/led-colors';
import { Edit, Eye, EyeOff, Plus, RefreshCw, Shield, Trash2, UserPlus, Users } from 'lucide-react';

interface AdminAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
}

type TabKey = 'assignments' | 'banks' | 'users' | 'active';
type UserSortBy = 'display_name' | 'email' | 'created_at' | 'last_sign_in_at' | 'ban_status';
type BankSortBy = 'title' | 'created_at' | 'access_count';
type AssignmentUserSortBy = 'display_name' | 'email' | 'created_at';
type AssignmentBankSortBy = 'title' | 'status' | 'access_count';
type ActiveSortBy = 'user_id' | 'email' | 'device_name' | 'platform' | 'last_seen_at';
const ACTIVE_SORT_STORAGE_KEY = 'vdjv-admin-active-sort';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'banks', label: 'Banks' },
  { key: 'users', label: 'Users' },
  { key: 'active', label: 'Active' },
];

const isUserBanned = (user: AdminUser | null): boolean => {
  if (!user?.banned_until) return false;
  const dt = new Date(user.banned_until).getTime();
  return !Number.isNaN(dt) && dt > Date.now();
};

const BANK_COLOR_NAMES = [
  'Dim Gray',
  'Gray',
  'White',
  'Red',
  'Amber',
  'Orange',
  'Light Yellow',
  'Yellow',
  'Green',
  'Aqua',
  'Blue',
  'Pure Blue',
  'Violet',
  'Purple',
  'Hot Pink',
  'Hot Pink 2',
  'Deep Magenta',
  'Deep Brown 2',
];

const colorOptions = BANK_COLOR_NAMES
  .map((name) => LED_COLOR_PALETTE.find((entry) => entry.name === name))
  .filter(Boolean)
  .map((entry) => ({ label: entry!.name, value: entry!.hex }));

type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string };

function useNotices() {
  const [notices, setNotices] = React.useState<Notice[]>([]);
  const dismiss = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((n) => n.id !== id));
  }, []);
  const pushNotice = React.useCallback((notice: Omit<Notice, 'id'>) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now() + Math.random());
    setNotices((arr) => [{ id, ...notice }, ...arr]);
    window.setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);
  return { notices, pushNotice, dismiss };
}

function NoticesPortal({ notices, dismiss, theme }: { notices: Notice[]; dismiss: (id: string) => void; theme: 'light' | 'dark' }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
      <div className="w-full max-w-xl px-3">
        {notices.map((notice) => (
          <div
            key={notice.id}
            className={`pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg ${
              notice.variant === 'success'
                ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 border-green-700 text-white')
                : notice.variant === 'error'
                  ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 border-red-700 text-white')
                  : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 border-gray-800 text-white')
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 text-sm">{notice.message}</div>
              <button className="text-white/80 hover:text-white" onClick={() => dismiss(notice.id)} aria-label="Dismiss">×</button>
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

const SortHeader = ({
  title,
  active,
  direction,
  onClick,
}: {
  title: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) => (
  <button type="button" onClick={onClick} className="inline-flex items-center gap-1 font-medium">
    {title}
    <span className="text-xs opacity-70">{active ? (direction === 'asc' ? '^' : 'v') : '*'}</span>
  </button>
);

export function AdminAccessDialog({ open, onOpenChange, theme }: AdminAccessDialogProps) {
  const readStoredActiveSort = React.useCallback((): { sortBy: ActiveSortBy; sortDir: SortDirection } => {
    if (typeof window === 'undefined') return { sortBy: 'last_seen_at', sortDir: 'desc' };
    try {
      const raw = localStorage.getItem(ACTIVE_SORT_STORAGE_KEY);
      if (!raw) return { sortBy: 'last_seen_at', sortDir: 'desc' };
      const parsed = JSON.parse(raw) as { sortBy?: string; sortDir?: string };
      const validSortBy: ActiveSortBy[] = ['user_id', 'email', 'device_name', 'platform', 'last_seen_at'];
      const sortBy = validSortBy.includes(parsed.sortBy as ActiveSortBy) ? (parsed.sortBy as ActiveSortBy) : 'last_seen_at';
      const sortDir: SortDirection = parsed.sortDir === 'asc' ? 'asc' : 'desc';
      return { sortBy, sortDir };
    } catch {
      return { sortBy: 'last_seen_at', sortDir: 'desc' };
    }
  }, []);

  const initialActiveSort = React.useMemo(() => readStoredActiveSort(), [readStoredActiveSort]);
  const [tab, setTab] = React.useState<TabKey>('assignments');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const { notices, pushNotice, dismiss } = useNotices();

  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = React.useState(false);
  const [usersQuery, setUsersQuery] = React.useState('');
  const [usersSortBy, setUsersSortBy] = React.useState<UserSortBy>('created_at');
  const [usersSortDir, setUsersSortDir] = React.useState<SortDirection>('desc');
  const [assignmentUserSortBy, setAssignmentUserSortBy] = React.useState<AssignmentUserSortBy>('created_at');
  const [assignmentUserSortDir, setAssignmentUserSortDir] = React.useState<SortDirection>('desc');

  const [banks, setBanks] = React.useState<AdminBank[]>([]);
  const [banksLoading, setBanksLoading] = React.useState(false);
  const [banksQuery, setBanksQuery] = React.useState('');
  const [banksSortBy, setBanksSortBy] = React.useState<BankSortBy>('created_at');
  const [banksSortDir, setBanksSortDir] = React.useState<SortDirection>('desc');
  const [assignmentBankSortBy, setAssignmentBankSortBy] = React.useState<AssignmentBankSortBy>('title');
  const [assignmentBankSortDir, setAssignmentBankSortDir] = React.useState<SortDirection>('asc');

  const [selectedUserId, setSelectedUserId] = React.useState('');
  const [selectedBankIds, setSelectedBankIds] = React.useState<Set<string>>(new Set());
  const [accessRows, setAccessRows] = React.useState<AccessEntry[]>([]);
  const [accessLoading, setAccessLoading] = React.useState(false);
  const [bulkLoading, setBulkLoading] = React.useState(false);

  const [activeLoading, setActiveLoading] = React.useState(false);
  const [activeCounts, setActiveCounts] = React.useState({ activeUsers: 0, activeSessions: 0 });
  const [activeSessions, setActiveSessions] = React.useState<ActiveSessionRow[]>([]);
  const [activeSortBy, setActiveSortBy] = React.useState<ActiveSortBy>(initialActiveSort.sortBy);
  const [activeSortDir, setActiveSortDir] = React.useState<SortDirection>(initialActiveSort.sortDir);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createEmail, setCreateEmail] = React.useState('');
  const [createPassword, setCreatePassword] = React.useState('');
  const [showCreatePassword, setShowCreatePassword] = React.useState(false);
  const [createDisplayName, setCreateDisplayName] = React.useState('');
  const [createLoading, setCreateLoading] = React.useState(false);

  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [detailsUser, setDetailsUser] = React.useState<AdminUser | null>(null);
  const [editDisplayName, setEditDisplayName] = React.useState('');
  const [profileSaving, setProfileSaving] = React.useState(false);
  const [banOpen, setBanOpen] = React.useState(false);
  const [banHours, setBanHours] = React.useState(24);
  const [deleteUserOpen, setDeleteUserOpen] = React.useState(false);
  const [unbanOpen, setUnbanOpen] = React.useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = React.useState(false);

  const [editBankOpen, setEditBankOpen] = React.useState(false);
  const [editBank, setEditBank] = React.useState<AdminBank | null>(null);
  const [editBankTitle, setEditBankTitle] = React.useState('');
  const [editBankDesc, setEditBankDesc] = React.useState('');
  const [editBankColor, setEditBankColor] = React.useState('#3b82f6');
  const [bankSaving, setBankSaving] = React.useState(false);
  const [deleteBankOpen, setDeleteBankOpen] = React.useState(false);
  const [deleteBank, setDeleteBank] = React.useState<AdminBank | null>(null);

  const selectedUser = React.useMemo(() => users.find((u) => u.id === selectedUserId) || null, [users, selectedUserId]);
  const grantedBankIds = React.useMemo(() => new Set(accessRows.map((r) => r.bank_id)), [accessRows]);

  const assignmentUsers = React.useMemo(() => {
    const sorted = [...users].sort((a, b) => {
      if (assignmentUserSortBy === 'display_name') return String(a.display_name || '').localeCompare(String(b.display_name || ''), undefined, { sensitivity: 'base' });
      if (assignmentUserSortBy === 'email') return String(a.email || '').localeCompare(String(b.email || ''), undefined, { sensitivity: 'base' });
      const left = a.created_at ? new Date(a.created_at).getTime() : 0;
      const right = b.created_at ? new Date(b.created_at).getTime() : 0;
      return left - right;
    });
    return assignmentUserSortDir === 'asc' ? sorted : sorted.reverse();
  }, [users, assignmentUserSortBy, assignmentUserSortDir]);

  const assignmentBanks = React.useMemo(() => {
    const sorted = [...banks].sort((a, b) => {
      if (assignmentBankSortBy === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      if (assignmentBankSortBy === 'status') {
        const left = grantedBankIds.has(a.id) ? 1 : 0;
        const right = grantedBankIds.has(b.id) ? 1 : 0;
        return left - right;
      }
      return (a.access_count || 0) - (b.access_count || 0);
    });
    return assignmentBankSortDir === 'asc' ? sorted : sorted.reverse();
  }, [banks, assignmentBankSortBy, assignmentBankSortDir, grantedBankIds]);

  const activeUsersRows = React.useMemo(() => {
    const map = new Map<string, ActiveSessionRow>();
    activeSessions.forEach((row) => {
      const prev = map.get(row.user_id);
      if (!prev || new Date(row.last_seen_at).getTime() > new Date(prev.last_seen_at).getTime()) {
        map.set(row.user_id, row);
      }
    });
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      if (activeSortBy === 'user_id') return String(a.user_id || '').localeCompare(String(b.user_id || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'email') return String(a.email || '').localeCompare(String(b.email || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'device_name') return String(a.device_name || '').localeCompare(String(b.device_name || ''), undefined, { sensitivity: 'base' });
      if (activeSortBy === 'platform') {
        const left = [a.platform, a.browser, a.os].filter(Boolean).join(' / ');
        const right = [b.platform, b.browser, b.os].filter(Boolean).join(' / ');
        return left.localeCompare(right, undefined, { sensitivity: 'base' });
      }
      const left = new Date(a.last_seen_at).getTime();
      const right = new Date(b.last_seen_at).getTime();
      return left - right;
    });
    return activeSortDir === 'asc' ? rows : rows.reverse();
  }, [activeSessions, activeSortBy, activeSortDir]);

  React.useEffect(() => {
    if (!error) return;
    pushNotice({ variant: 'error', message: error });
    setError('');
  }, [error, pushNotice]);

  React.useEffect(() => {
    if (!info) return;
    pushNotice({ variant: 'success', message: info });
    setInfo('');
  }, [info, pushNotice]);

  const refreshUsers = React.useCallback(async () => {
    setUsersLoading(true);
    try {
      const data = await adminApi.listUsers({
        q: usersQuery,
        perPage: 1000,
        includeAdmins: false,
        sortBy: usersSortBy,
        sortDir: usersSortDir,
      });
      setUsers(data.users || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [usersQuery, usersSortBy, usersSortDir]);

  const refreshBanks = React.useCallback(async () => {
    setBanksLoading(true);
    try {
      const data = await adminApi.listBanks({
        q: banksQuery,
        sortBy: banksSortBy,
        sortDir: banksSortDir,
      });
      setBanks(data.banks || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to load banks');
    } finally {
      setBanksLoading(false);
    }
  }, [banksQuery, banksSortBy, banksSortDir]);

  const refreshAccess = React.useCallback(async (userId: string) => {
    if (!userId) {
      setAccessRows([]);
      return;
    }
    setAccessLoading(true);
    try {
      const data = await adminApi.getUserAccess(userId);
      setAccessRows(data.access || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to load access');
      setAccessRows([]);
    } finally {
      setAccessLoading(false);
    }
  }, []);

  const refreshActive = React.useCallback(async () => {
    setActiveLoading(true);
    try {
      const data = await adminApi.listActiveSessions({ limit: 300 });
      setActiveCounts({
        activeUsers: Number(data?.counts?.activeUsers || 0),
        activeSessions: Number(data?.counts?.activeSessions || 0),
      });
      setActiveSessions(data?.sessions || []);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to load active sessions');
      setActiveCounts({ activeUsers: 0, activeSessions: 0 });
      setActiveSessions([]);
    } finally {
      setActiveLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    setInfo('');
    setSelectedBankIds(new Set());
    setShowCreatePassword(false);
    void refreshUsers();
    void refreshBanks();
    void refreshActive();
  }, [open, refreshUsers, refreshBanks, refreshActive]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(
      ACTIVE_SORT_STORAGE_KEY,
      JSON.stringify({ sortBy: activeSortBy, sortDir: activeSortDir }),
    );
  }, [activeSortBy, activeSortDir]);

  React.useEffect(() => {
    if (!open) return;
    if (!selectedUserId) {
      setAccessRows([]);
      return;
    }
    void refreshAccess(selectedUserId);
  }, [open, selectedUserId, refreshAccess]);

  React.useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => void refreshActive(), 30000);
    return () => window.clearInterval(timer);
  }, [open, refreshActive]);

  const toggleUserSort = (next: UserSortBy) => {
    if (usersSortBy === next) setUsersSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setUsersSortBy(next);
      setUsersSortDir(next === 'created_at' || next === 'last_sign_in_at' ? 'desc' : 'asc');
    }
  };

  const toggleBankSort = (next: BankSortBy) => {
    if (banksSortBy === next) setBanksSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setBanksSortBy(next);
      setBanksSortDir(next === 'created_at' || next === 'access_count' ? 'desc' : 'asc');
    }
  };

  const toggleAssignmentUserSort = (next: AssignmentUserSortBy) => {
    if (assignmentUserSortBy === next) {
      setAssignmentUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setAssignmentUserSortBy(next);
    setAssignmentUserSortDir(next === 'created_at' ? 'desc' : 'asc');
  };

  const toggleAssignmentBankSort = (next: AssignmentBankSortBy) => {
    if (assignmentBankSortBy === next) {
      setAssignmentBankSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setAssignmentBankSortBy(next);
    setAssignmentBankSortDir(next === 'access_count' ? 'desc' : 'asc');
  };

  const toggleActiveSort = (next: ActiveSortBy) => {
    if (activeSortBy === next) {
      setActiveSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setActiveSortBy(next);
    setActiveSortDir(next === 'last_seen_at' ? 'desc' : 'asc');
  };

  const toggleSelectBank = (bankId: string) => {
    setSelectedBankIds((prev) => {
      const next = new Set(prev);
      if (next.has(bankId)) next.delete(bankId);
      else next.add(bankId);
      return next;
    });
  };

  const selectedIds = Array.from(selectedBankIds);
  const selectedGrantIds = selectedIds.filter((id) => !grantedBankIds.has(id));
  const selectedRevokeIds = selectedIds.filter((id) => grantedBankIds.has(id));
  const allGrantIds = banks.filter((b) => !grantedBankIds.has(b.id)).map((b) => b.id);
  const allRevokeIds = banks.filter((b) => grantedBankIds.has(b.id)).map((b) => b.id);

  const doGrant = async (bankIds: string[]) => {
    if (!selectedUserId || bankIds.length === 0) return;
    setBulkLoading(true);
    try {
      await adminApi.grantUserAccess(selectedUserId, bankIds);
      setInfo(`Granted ${bankIds.length} bank(s).`);
      setSelectedBankIds(new Set());
      await Promise.all([refreshAccess(selectedUserId), refreshBanks()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Grant failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const doRevoke = async (bankIds: string[]) => {
    if (!selectedUserId || bankIds.length === 0) return;
    setBulkLoading(true);
    try {
      await adminApi.revokeUserAccess(selectedUserId, bankIds);
      setInfo(`Revoked ${bankIds.length} bank(s).`);
      setSelectedBankIds(new Set());
      await Promise.all([refreshAccess(selectedUserId), refreshBanks()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Revoke failed');
    } finally {
      setBulkLoading(false);
    }
  };

  const createUser = async () => {
    const email = createEmail.trim().toLowerCase();
    if (!email) {
      setError('Email is required.');
      return;
    }
    if (!createPassword || createPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setCreateLoading(true);
    try {
      await adminApi.createUser({
        email,
        password: createPassword,
        displayName: createDisplayName.trim() || undefined,
      });
      setCreateEmail('');
      setCreatePassword('');
      setCreateDisplayName('');
      setCreateOpen(false);
      setInfo('User created.');
      await refreshUsers();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  const saveUserProfile = async () => {
    if (!detailsUser) return;
    const displayName = editDisplayName.trim();
    if (!displayName) {
      setError('Display name is required.');
      return;
    }
    setProfileSaving(true);
    try {
      await adminApi.updateUserProfile(detailsUser.id, { displayName });
      setDetailsUser((prev) => (prev ? { ...prev, display_name: displayName } : prev));
      setInfo('User profile updated.');
      await refreshUsers();
      if (selectedUserId) await refreshAccess(selectedUserId);
      setDetailsOpen(false);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const removeUser = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.deleteUser(detailsUser.id);
      setDeleteUserOpen(false);
      setDetailsOpen(false);
      if (selectedUserId === detailsUser.id) setSelectedUserId('');
      setInfo('User deleted.');
      await Promise.all([refreshUsers(), refreshBanks()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to delete user');
    }
  };

  const banUser = async () => {
    if (!detailsUser) return;
    try {
      const result = await adminApi.banUser(detailsUser.id, banHours);
      setDetailsUser((prev) => (prev ? { ...prev, banned_until: result.banned_until || prev.banned_until } : prev));
      setBanOpen(false);
      setInfo(`User banned for ${banHours} hour(s).`);
      await refreshUsers();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to ban user');
    }
  };

  const unbanUser = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.unbanUser(detailsUser.id);
      setDetailsUser((prev) => (prev ? { ...prev, banned_until: null } : prev));
      setInfo('User unbanned.');
      await refreshUsers();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to unban user');
    }
  };

  const sendReset = async () => {
    if (!detailsUser) return;
    try {
      await adminApi.resetPassword(detailsUser.id);
      setInfo('Password reset email sent.');
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to send reset email');
    }
  };

  const saveBank = async () => {
    if (!editBank) return;
    const title = editBankTitle.trim();
    if (!title) {
      setError('Bank title is required.');
      return;
    }
    setBankSaving(true);
    try {
      await adminApi.updateBank(editBank.id, { title, description: editBankDesc.trim(), color: editBankColor });
      setInfo('Bank updated.');
      setEditBankOpen(false);
      await refreshBanks();
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to update bank');
    } finally {
      setBankSaving(false);
    }
  };

  const removeBank = async () => {
    if (!deleteBank) return;
    try {
      await adminApi.deleteBank(deleteBank.id, true);
      setInfo(`Bank "${deleteBank.title}" deleted and access revoked.`);
      setDeleteBankOpen(false);
      setDeleteBank(null);
      await Promise.all([refreshBanks(), selectedUserId ? refreshAccess(selectedUserId) : Promise.resolve()]);
      setError('');
    } catch (e: any) {
      setError(e?.message || 'Failed to delete bank');
    }
  };

  const openUserDetails = (user: AdminUser) => {
    setDetailsUser(user);
    setEditDisplayName(user.display_name || '');
    setBanHours(24);
    setDetailsOpen(true);
  };

  return (
    <>
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className={`w-[95vw] max-w-6xl h-[90vh] max-h-[90vh] overflow-hidden grid grid-rows-[auto_1fr] ${theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Admin Access
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 min-h-0 h-full overflow-hidden flex flex-col">
            <div className="flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Button key={t.key} size="sm" variant={tab === t.key ? 'default' : 'outline'} onClick={() => setTab(t.key)}>
                  {t.label}
                </Button>
              ))}
            </div>
            {tab === 'assignments' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full min-h-0 overflow-hidden">
                <div className="border rounded p-3 space-y-2 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between">
                    <Label>Select User</Label>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant={assignmentUserSortBy === 'created_at' ? 'secondary' : 'outline'} onClick={() => toggleAssignmentUserSort('created_at')}>
                        Newest
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void refreshUsers()} disabled={usersLoading}>
                        <RefreshCw className={`w-4 h-4 ${usersLoading ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>
                  <Input value={usersQuery} onChange={(e) => setUsersQuery(e.target.value)} placeholder="Search users..." onKeyDown={(e) => e.key === 'Enter' && void refreshUsers()} />
                  <div className="flex-1 min-h-0 overflow-auto border rounded">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead><SortHeader title="User" active={assignmentUserSortBy === 'display_name'} direction={assignmentUserSortDir} onClick={() => toggleAssignmentUserSort('display_name')} /></TableHead>
                          <TableHead><SortHeader title="Email" active={assignmentUserSortBy === 'email'} direction={assignmentUserSortDir} onClick={() => toggleAssignmentUserSort('email')} /></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignmentUsers.map((u) => (
                          <TableRow key={u.id} className={`cursor-pointer ${selectedUserId === u.id ? (theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100') : ''}`} onClick={() => setSelectedUserId(u.id)}>
                            <TableCell className="max-w-[200px] truncate" title={u.display_name}>{u.display_name}</TableCell>
                            <TableCell className="max-w-[220px] truncate" title={u.email || ''}>{u.email || '-'}</TableCell>
                          </TableRow>
                        ))}
                        {!usersLoading && assignmentUsers.length === 0 && <TableRow><TableCell colSpan={2} className="text-center py-3 opacity-70">No users</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </div>
                <div className="border rounded p-3 space-y-2 min-h-0 flex flex-col">
                  <div className="text-sm">
                    <div className="font-medium">Bank Access</div>
                    <div className="text-xs opacity-70">
                      {accessLoading
                        ? 'Loading access...'
                        : selectedUser
                          ? `${selectedUser.display_name} (${selectedUser.email || 'no email'})`
                          : 'Select a user first'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void doGrant(selectedGrantIds)} disabled={!selectedUserId || selectedGrantIds.length === 0 || bulkLoading}>Grant Selected ({selectedGrantIds.length})</Button>
                    <Button size="sm" variant="outline" onClick={() => void doRevoke(selectedRevokeIds)} disabled={!selectedUserId || selectedRevokeIds.length === 0 || bulkLoading}>Revoke Selected ({selectedRevokeIds.length})</Button>
                    <Button size="sm" variant="secondary" onClick={() => void doGrant(allGrantIds)} disabled={!selectedUserId || allGrantIds.length === 0 || bulkLoading}>Grant All ({allGrantIds.length})</Button>
                    <Button size="sm" variant="outline" onClick={() => void doRevoke(allRevokeIds)} disabled={!selectedUserId || allRevokeIds.length === 0 || bulkLoading}>Revoke All ({allRevokeIds.length})</Button>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto border rounded">
                    <Table className="table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10" />
                          <TableHead><SortHeader title="Bank" active={assignmentBankSortBy === 'title'} direction={assignmentBankSortDir} onClick={() => toggleAssignmentBankSort('title')} /></TableHead>
                          <TableHead><SortHeader title="Status" active={assignmentBankSortBy === 'status'} direction={assignmentBankSortDir} onClick={() => toggleAssignmentBankSort('status')} /></TableHead>
                          <TableHead><SortHeader title="Access" active={assignmentBankSortBy === 'access_count'} direction={assignmentBankSortDir} onClick={() => toggleAssignmentBankSort('access_count')} /></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {assignmentBanks.map((b) => {
                          const granted = grantedBankIds.has(b.id);
                          return (
                            <TableRow key={b.id}>
                              <TableCell><Checkbox checked={selectedBankIds.has(b.id)} onCheckedChange={() => toggleSelectBank(b.id)} disabled={!selectedUserId} /></TableCell>
                              <TableCell><div className="font-medium truncate max-w-[240px]" title={b.title}>{b.title}</div><div className="text-xs opacity-70 truncate max-w-[240px]" title={b.description || ''}>{b.description || '-'}</div></TableCell>
                              <TableCell><span className={`text-xs px-2 py-1 rounded ${granted ? 'bg-emerald-600/20 text-emerald-500' : 'bg-gray-600/20 text-gray-500'}`}>{granted ? 'Granted' : 'Not granted'}</span></TableCell>
                              <TableCell>{b.access_count}</TableCell>
                            </TableRow>
                          );
                        })}
                        {!banksLoading && assignmentBanks.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-3 opacity-70">No banks</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            )}

            {tab === 'banks' && (
              <div className="border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Search Banks</Label>
                    <Input value={banksQuery} onChange={(e) => setBanksQuery(e.target.value)} placeholder="Search title or description..." onKeyDown={(e) => e.key === 'Enter' && void refreshBanks()} />
                  </div>
                  <Button variant="outline" onClick={() => void refreshBanks()} disabled={banksLoading}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${banksLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Color</TableHead>
                        <TableHead><SortHeader title="Title" active={banksSortBy === 'title'} direction={banksSortDir} onClick={() => toggleBankSort('title')} /></TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead><SortHeader title="Created" active={banksSortBy === 'created_at'} direction={banksSortDir} onClick={() => toggleBankSort('created_at')} /></TableHead>
                        <TableHead><SortHeader title="Access" active={banksSortBy === 'access_count'} direction={banksSortDir} onClick={() => toggleBankSort('access_count')} /></TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {banks.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell><span className="inline-block w-5 h-5 rounded border" style={{ backgroundColor: b.color || '#3b82f6' }} /></TableCell>
                          <TableCell>{b.title}</TableCell>
                          <TableCell className="max-w-[280px] truncate" title={b.description || ''}>{b.description || '-'}</TableCell>
                          <TableCell>{b.created_at ? new Date(b.created_at).toLocaleString() : '-'}</TableCell>
                          <TableCell>{b.access_count}</TableCell>
                          <TableCell className="text-right space-x-2">
                            <Button size="sm" variant="outline" onClick={() => { setEditBank(b); setEditBankTitle(b.title); setEditBankDesc(b.description || ''); setEditBankColor(b.color || '#3b82f6'); setEditBankOpen(true); }}><Edit className="w-4 h-4" /></Button>
                            <Button size="sm" variant="destructive" onClick={() => { setDeleteBank(b); setDeleteBankOpen(true); }}><Trash2 className="w-4 h-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!banksLoading && banks.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-3 opacity-70">No banks</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {tab === 'users' && (
              <div className="border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <Label>Search Users</Label>
                    <Input value={usersQuery} onChange={(e) => setUsersQuery(e.target.value)} placeholder="Search name, email, id..." onKeyDown={(e) => e.key === 'Enter' && void refreshUsers()} />
                  </div>
                  <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4 mr-1" />Add User</Button>
                  <Button variant="outline" onClick={() => void refreshUsers()} disabled={usersLoading}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${usersLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><SortHeader title="Display Name" active={usersSortBy === 'display_name'} direction={usersSortDir} onClick={() => toggleUserSort('display_name')} /></TableHead>
                        <TableHead><SortHeader title="Email" active={usersSortBy === 'email'} direction={usersSortDir} onClick={() => toggleUserSort('email')} /></TableHead>
                        <TableHead><SortHeader title="Created" active={usersSortBy === 'created_at'} direction={usersSortDir} onClick={() => toggleUserSort('created_at')} /></TableHead>
                        <TableHead><SortHeader title="Last Sign-In" active={usersSortBy === 'last_sign_in_at'} direction={usersSortDir} onClick={() => toggleUserSort('last_sign_in_at')} /></TableHead>
                        <TableHead><SortHeader title="Ban Status" active={usersSortBy === 'ban_status'} direction={usersSortDir} onClick={() => toggleUserSort('ban_status')} /></TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell>{u.display_name}</TableCell>
                          <TableCell>{u.email || '-'}</TableCell>
                          <TableCell>{u.created_at ? new Date(u.created_at).toLocaleString() : '-'}</TableCell>
                          <TableCell>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : '-'}</TableCell>
                          <TableCell><span className={`text-xs px-2 py-1 rounded ${isUserBanned(u) ? 'bg-red-600/20 text-red-500' : 'bg-emerald-600/20 text-emerald-500'}`}>{isUserBanned(u) ? 'Banned' : 'Active'}</span></TableCell>
                          <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => openUserDetails(u)}>Edit</Button></TableCell>
                        </TableRow>
                      ))}
                      {!usersLoading && users.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-3 opacity-70">No users</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {tab === 'active' && (
              <div className="border rounded p-3 space-y-2 h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Active Users</Label>
                    <div className="text-xs opacity-70">Non-admin users currently online.</div>
                  </div>
                  <Button variant="outline" onClick={() => void refreshActive()} disabled={activeLoading}>
                    <RefreshCw className={`w-4 h-4 mr-1 ${activeLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className={`border rounded p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}><div className="text-xs opacity-70">Active Users</div><div className="text-xl font-semibold">{activeCounts.activeUsers}</div></div>
                  <div className={`border rounded p-3 ${theme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}><div className="text-xs opacity-70">Active Sessions</div><div className="text-xl font-semibold">{activeCounts.activeSessions}</div></div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto border rounded">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead><SortHeader title="User" active={activeSortBy === 'user_id'} direction={activeSortDir} onClick={() => toggleActiveSort('user_id')} /></TableHead>
                        <TableHead><SortHeader title="Email" active={activeSortBy === 'email'} direction={activeSortDir} onClick={() => toggleActiveSort('email')} /></TableHead>
                        <TableHead><SortHeader title="Device Name" active={activeSortBy === 'device_name'} direction={activeSortDir} onClick={() => toggleActiveSort('device_name')} /></TableHead>
                        <TableHead><SortHeader title="Platform / Browser / OS" active={activeSortBy === 'platform'} direction={activeSortDir} onClick={() => toggleActiveSort('platform')} /></TableHead>
                        <TableHead><SortHeader title="Last Seen" active={activeSortBy === 'last_seen_at'} direction={activeSortDir} onClick={() => toggleActiveSort('last_seen_at')} /></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeUsersRows.map((row) => (
                        <TableRow key={row.user_id}>
                          <TableCell className="font-mono text-xs">{row.user_id.slice(0, 8)}...</TableCell>
                          <TableCell>{row.email || '-'}</TableCell>
                          <TableCell>{row.device_name || '-'}</TableCell>
                          <TableCell>{[row.platform, row.browser, row.os].filter(Boolean).join(' / ') || '-'}</TableCell>
                          <TableCell>{new Date(row.last_seen_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                      {!activeLoading && activeUsersRows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-3 opacity-70">No active users</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen} useHistory={false}>
        <DialogContent aria-describedby={undefined} className={theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              Add User
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createUser();
            }}
          >
            <div><Label>Email</Label><Input type="email" autoComplete="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="user@example.com" /></div>
            <div className="space-y-1">
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showCreatePassword ? 'text' : 'password'}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800"
                  onClick={() => setShowCreatePassword((v) => !v)}
                  aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                >
                  {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div><Label>Display Name</Label><Input value={createDisplayName} onChange={(e) => setCreateDisplayName(e.target.value)} placeholder="Optional" /></div>
            <div className="text-xs opacity-70">User is auto-confirmed.</div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={createLoading}>{createLoading ? 'Creating...' : 'Create User'}</Button>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen} useHistory={false}>
        <DialogContent aria-describedby={undefined} className={theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              User Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div><Label>Display Name</Label><Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} /></div>
            <div><Label>Email</Label><div>{detailsUser?.email || '-'}</div></div>
            <div><Label>UID</Label><div className="font-mono text-xs break-all">{detailsUser?.id || '-'}</div></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div><Label>Created</Label><div>{detailsUser?.created_at ? new Date(detailsUser.created_at).toLocaleString() : '-'}</div></div>
              <div><Label>Last Sign-In</Label><div>{detailsUser?.last_sign_in_at ? new Date(detailsUser.last_sign_in_at).toLocaleString() : '-'}</div></div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={profileSaving} onClick={saveUserProfile}>{profileSaving ? 'Saving...' : 'Save Profile'}</Button>
              <Button variant="outline" className="flex-1" onClick={() => setResetPasswordOpen(true)}>Send Password Reset</Button>
            </div>
            <div className="flex gap-2">
              {isUserBanned(detailsUser) ? <Button variant="outline" className="flex-1" onClick={() => setUnbanOpen(true)}>Unban User</Button> : <Button variant="outline" className="flex-1" onClick={() => setBanOpen(true)}>Ban User</Button>}
              <Button variant="destructive" className="flex-1" onClick={() => setDeleteUserOpen(true)}>Delete User</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={banOpen} onOpenChange={setBanOpen} useHistory={false}>
        <DialogContent aria-describedby={undefined} className={theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>
          <DialogHeader><DialogTitle>Ban User</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Ban Duration (hours)</Label><Input type="number" min={1} max={8760} value={banHours} onChange={(e) => setBanHours(Math.max(1, Math.min(8760, Number(e.target.value) || 24)))} /></div>
            <div className="text-xs opacity-70">Ban until: {new Date(Date.now() + banHours * 60 * 60 * 1000).toLocaleString()}</div>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" onClick={banUser}>Ban User</Button>
              <Button variant="outline" onClick={() => setBanOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editBankOpen} onOpenChange={setEditBankOpen} useHistory={false}>
        <DialogContent aria-describedby={undefined} className={theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}>
          <DialogHeader><DialogTitle>Edit Bank</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <div><Label>Title</Label><Input value={editBankTitle} onChange={(e) => setEditBankTitle(e.target.value)} /></div>
            <div><Label>Description</Label><textarea className={`w-full min-h-[120px] rounded border p-2 ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`} value={editBankDesc} onChange={(e) => setEditBankDesc(e.target.value)} /></div>
            <div className="space-y-1">
              <Label>Bank Color</Label>
              <div className="flex flex-wrap gap-1">
                {colorOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    className={`w-6 h-6 rounded-full border-2 ${editBankColor === option.value ? 'border-white scale-110' : 'border-gray-500'}`}
                    style={{ backgroundColor: option.value }}
                    onClick={() => setEditBankColor(option.value)}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" disabled={bankSaving} onClick={saveBank}>{bankSaving ? 'Saving...' : 'Save'}</Button>
              <Button variant="outline" onClick={() => setEditBankOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog open={deleteUserOpen} onOpenChange={setDeleteUserOpen} title="Delete User" description="This will permanently delete the user account. This action cannot be undone." confirmText="Delete User" variant="destructive" onConfirm={removeUser} theme={theme} />
      <ConfirmationDialog open={unbanOpen} onOpenChange={setUnbanOpen} title="Unban User" description={`Unban "${detailsUser?.display_name || detailsUser?.email || 'this user'}"?`} confirmText="Unban User" onConfirm={unbanUser} theme={theme} />
      <ConfirmationDialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen} title="Send Password Reset" description={`Send password reset email to "${detailsUser?.email || 'this user'}"?`} confirmText="Send Reset" onConfirm={sendReset} theme={theme} />
      <ConfirmationDialog open={deleteBankOpen} onOpenChange={setDeleteBankOpen} title="Delete Bank" description={`Delete "${deleteBank?.title || 'this bank'}" and revoke all user access?`} confirmText="Delete Bank" variant="destructive" onConfirm={removeBank} theme={theme} />
    </>
  );
}
