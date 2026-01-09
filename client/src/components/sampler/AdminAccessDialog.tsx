import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { Trash2, Plus, Shield, UserPlus } from 'lucide-react';

interface AdminAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
}

interface DbBank {
  id: string;
  title: string;
  created_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string;
  role: 'admin' | 'user';
  email?: string;
  created_at?: string;
  last_sign_in_at?: string;
  banned_until?: string;
}

interface AccessRow {
  id: string;
  user_id: string;
  bank_id: string;
  granted_at: string;
  profile?: ProfileRow;
}

export function AdminAccessDialog({ open, onOpenChange, theme }: AdminAccessDialogProps) {
  const [banks, setBanks] = React.useState<DbBank[]>([]);
  const [profiles, setProfiles] = React.useState<ProfileRow[]>([]);
  const [selectedBankId, setSelectedBankId] = React.useState<string>('');
  const [access, setAccess] = React.useState<AccessRow[]>([]);
  const [filter, setFilter] = React.useState<string>('');
  const [newUserId, setNewUserId] = React.useState<string>('');
  const [userPickerOpen, setUserPickerOpen] = React.useState(false);
  const [userSearch, setUserSearch] = React.useState('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string>('');
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [detailsUser, setDetailsUser] = React.useState<ProfileRow | null>(null);
  const [actionInfo, setActionInfo] = React.useState<string>('');
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [revokeId, setRevokeId] = React.useState<string | null>(null);
  const [deleteUserOpen, setDeleteUserOpen] = React.useState(false);
  const [banUserOpen, setBanUserOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [unbanUserOpen, setUnbanUserOpen] = React.useState(false);
  const [banHours, setBanHours] = React.useState(24);

  const loadBanks = React.useCallback(async () => {
    const { data, error } = await supabase.from('banks').select('id, title, created_at').order('created_at', { ascending: false });
    if (!error && data) setBanks(data as any);
  }, []);

  const loadProfiles = React.useCallback(async () => {
    try {
      // Pull profile basic info from profiles table
      const { data: base, error: baseErr } = await supabase
        .from('profiles')
        .select('id, display_name, role')
        .order('display_name');
      if (baseErr || !base) { setProfiles([]); return; }

      // Enrich with auth-admin data via our backend
      const resp = await fetch(`/api/admin/users?perPage=1000`);
      const payload = await resp.json();
      const users: Array<{ id: string; email?: string; created_at?: string; last_sign_in_at?: string; display_name?: string; banned_until?: string; }> = payload?.users || [];
      const userMap = new Map(users.map((u) => [u.id, u]));

      const merged: ProfileRow[] = (base as any).map((p: any) => {
        const u = userMap.get(p.id);
        return {
          id: p.id,
          display_name: p.display_name,
          role: p.role,
          email: u?.email,
          created_at: u?.created_at,
          last_sign_in_at: u?.last_sign_in_at,
          banned_until: u?.banned_until,
        } as ProfileRow;
      });
      setProfiles(merged);
    } catch {
      // Fallback to base only
      const { data } = await supabase.from('profiles').select('id, display_name, role').order('display_name');
      setProfiles((data as any) || []);
    }
  }, []);

  const loadAccess = React.useCallback(async (bankId: string) => {
    if (!bankId) { setAccess([]); return; }
    // Load access rows
    const { data, error } = await supabase
      .from('user_bank_access')
      .select('id, user_id, bank_id, granted_at')
      .eq('bank_id', bankId)
      .order('granted_at', { ascending: false });
    if (error || !data) { setAccess([]); return; }

    // Enrich with user meta from admin API
    const resp = await fetch(`/api/admin/users?perPage=1000`);
    const payload = await resp.json();
    const users: Array<{ id: string; email?: string; created_at?: string; last_sign_in_at?: string; display_name?: string; banned_until?: string; }> = payload?.users || [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Also fetch display_name from profiles to avoid showing generic 'User'
    const userIds = (data as any).map((r: any) => r.user_id);
    const { data: profRows } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', userIds);
    const profMap = new Map((profRows || []).map((p: any) => [p.id, p.display_name as string]));

    const rows: AccessRow[] = (data as any).map((r: any) => {
      const u = userMap.get(r.user_id);
      const profile: ProfileRow = {
        id: r.user_id,
        display_name: profMap.get(r.user_id) || u?.display_name || (u?.email ? u.email.split('@')[0] : 'User'),
        role: 'user',
        email: u?.email,
        created_at: u?.created_at,
        last_sign_in_at: u?.last_sign_in_at,
        banned_until: u?.banned_until,
      };
      return { ...r, profile } as AccessRow;
    });
    setAccess(rows);
  }, []);

  React.useEffect(() => {
    if (open) {
      setError('');
      setNewUserId('');
      setFilter('');
      loadBanks();
      loadProfiles();
    }
  }, [open, loadBanks, loadProfiles]);

  React.useEffect(() => {
    if (open && selectedBankId) {
      loadAccess(selectedBankId);
    } else {
      setAccess([]);
    }
  }, [open, selectedBankId, loadAccess]);

  const handleGrant = async () => {
    if (!selectedBankId || !newUserId) return;
    setLoading(true);
    setError('');
    const { error } = await supabase
      .from('user_bank_access')
      .upsert({ user_id: newUserId, bank_id: selectedBankId }, { onConflict: 'user_id,bank_id' as any });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setNewUserId('');
    // Use setTimeout to avoid setState during render
    setTimeout(() => loadAccess(selectedBankId), 0);
  };

  const handleRevoke = async (accessId: string) => {
    if (!selectedBankId) return;
    setLoading(true);
    setError('');
    const { error } = await supabase
      .from('user_bank_access')
      .delete()
      .eq('id', accessId);
    setLoading(false);
    if (error) { setError(error.message); return; }
    // Use setTimeout to avoid setState during render
    setTimeout(() => loadAccess(selectedBankId), 0);
  };

  // Admin actions via server
  const callAdmin = async (path: string, body?: any) => {
    const res = await fetch(path, { 
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || 'Action failed');
    return json;
  };

  const handleDeleteUser = async () => {
    if (!detailsUser) return;
    await callAdmin(`/api/admin/users/${detailsUser.id}/delete`);
    setActionInfo('User deleted.');
    setDetailsOpen(false);
    // Use setTimeout to avoid setState during render
    setTimeout(() => {
      loadProfiles();
      if (selectedBankId) loadAccess(selectedBankId);
    }, 0);
  };

  const handleBanUser = async () => {
    if (!detailsUser) return;
    await callAdmin(`/api/admin/users/${detailsUser.id}/ban`, { hours: banHours });
    setActionInfo(`User banned for ${banHours} hours.`);
    // Refresh the user data to update ban status
    setTimeout(() => {
      loadProfiles();
      if (selectedBankId) loadAccess(selectedBankId);
    }, 0);
  };

  const handleResetPassword = async () => {
    if (!detailsUser) return;
    await callAdmin(`/api/admin/users/${detailsUser.id}/reset-password`);
    setActionInfo('Password reset email sent.');
  };

  const handleUnbanUser = async () => {
    if (!detailsUser) return;
    await callAdmin(`/api/admin/users/${detailsUser.id}/unban`);
    setActionInfo('User unbanned.');
    // Refresh the user data to update ban status
    setTimeout(() => {
      loadProfiles();
      if (selectedBankId) loadAccess(selectedBankId);
    }, 0);
  };

  const handleRoleChange = async (userId: string, role: 'admin' | 'user') => {
    setLoading(true);
    setError('');
    const { error } = await supabase
      .from('profiles')
      .update({ role })
      .eq('id', userId);
    setLoading(false);
    if (error) { setError(error.message); return; }
    // Use setTimeout to avoid setState during render
    setTimeout(() => {
      loadProfiles();
      if (selectedBankId) loadAccess(selectedBankId);
    }, 0);
  };

  const filteredProfiles = profiles.filter((p) =>
    !filter.trim()
      ? true
      : (p.display_name?.toLowerCase() || '').includes(filter.toLowerCase()) || (p.email || '').toLowerCase().includes(filter.toLowerCase()) || p.id.includes(filter)
  );

  const pickerProfiles = profiles.filter((p) =>
    !userSearch.trim()
      ? true
      : (p.display_name?.toLowerCase() || '').includes(userSearch.toLowerCase()) || (p.email || '').toLowerCase().includes(userSearch.toLowerCase()) || p.id.includes(userSearch)
  );

  // Check if user is banned
  const isUserBanned = (user: ProfileRow | null) => {
    if (!user?.banned_until) return false;
    const banDate = new Date(user.banned_until);
    return banDate > new Date();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-3xl ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-4 h-4" /> Admin Bank Access
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {error && (
            <div className={`p-2 rounded border ${theme === 'dark' ? 'bg-red-900/20 border-red-700 text-red-200' : 'bg-red-50 border-red-300 text-red-700'}`}>
              {error}
            </div>
          )}

          {/* Bank selector */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label>Bank</Label>
              <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bank" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.title || b.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Grant access to user</Label>
              <div className="flex gap-2">
                <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="min-w-0 flex-1 justify-start overflow-hidden">
                      <span className="truncate">
                        {newUserId ? (profiles.find((p) => p.id === newUserId)?.email || profiles.find((p) => p.id === newUserId)?.display_name || newUserId) : 'Search'}
                      </span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96" align="start">
                    <div className="space-y-2">
                      <Input placeholder="Type to search..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                      <div className="max-h-64 overflow-auto border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>User</TableHead>
                              <TableHead>Email</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pickerProfiles.map((p) => (
                              <TableRow key={p.id} className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => { setNewUserId(p.id); setUserPickerOpen(false); }}>
                                <TableCell>{p.display_name}</TableCell>
                                <TableCell>{p.email || '—'}</TableCell>
                              </TableRow>
                            ))}
                            {pickerProfiles.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={2} className="text-center py-3 opacity-70">No matches</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
                <Button onClick={handleGrant} disabled={!selectedBankId || !newUserId || loading} className="shrink-0">
                  <UserPlus className="w-4 h-4 mr-1" /> Grant
                </Button>
              </div>
            </div>
          </div>

          {/* Access list */}
          <div>
            <Label>Users with access</Label>
            <div className="border rounded mt-2 max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {access.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="truncate max-w-[200px]" title={row.profile?.id}>{row.profile?.display_name || row.user_id}</TableCell>
                      <TableCell>{row.profile?.email || '—'}</TableCell>
                      <TableCell>{new Date(row.granted_at).toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" onClick={() => { setRevokeId(row.id); setRevokeOpen(true); }} size="sm">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {access.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-3 opacity-70">No access entries</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Profiles inventory (preview) */}
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label>All users</Label>
                <Input placeholder="Filter by name or id" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
            </div>
            <div className="border rounded max-h-60 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="truncate max-w-[260px]" title={p.id}>{p.display_name}</TableCell>
                      <TableCell>{p.email || '—'}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => { setDetailsUser(p); setDetailsOpen(true); setActionInfo(''); }}>
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredProfiles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-3 opacity-70">No users</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {detailsOpen && (
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className={`sm:max-w-md ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <div className={`${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{detailsUser?.display_name || '—'}</div>
            </div>
            <div>
              <Label>Email</Label>
              <div className={`${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{detailsUser?.email || '—'}</div>
            </div>
            <div>
              <Label>UID</Label>
              <div className="font-mono text-xs break-all">{detailsUser?.id}</div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Created at</Label>
                <div className={`${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{detailsUser?.created_at || '—'}</div>
              </div>
              <div>
                <Label>Last sign in</Label>
                <div className={`${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>{detailsUser?.last_sign_in_at || '—'}</div>
              </div>
            </div>
            {actionInfo && (
              <div className={`p-2 rounded border ${theme === 'dark' ? 'bg-green-900/20 border-green-700 text-green-200' : 'bg-green-50 border-green-300 text-green-700'}`}>{actionInfo}</div>
            )}
            <div className="flex gap-2 pt-2">
              <Button variant="destructive" className="flex-1" onClick={() => setDeleteUserOpen(true)}>Delete user</Button>
              {isUserBanned(detailsUser) ? (
                <Button variant="outline" className="flex-1" onClick={() => setUnbanUserOpen(true)}>Unban user</Button>
              ) : (
                <Button variant="outline" className="flex-1" onClick={() => setBanUserOpen(true)}>Ban user</Button>
              )}
            </div>
            <Button className="w-full" onClick={() => setResetOpen(true)}>Send password reset</Button>
          </div>
        </DialogContent>
      </Dialog>
    )}

    <ConfirmationDialog
      open={revokeOpen}
      onOpenChange={setRevokeOpen}
      title="Remove Access"
      description="Are you sure you want to revoke this user's access to the selected bank?"
      confirmText="Remove Access"
      variant="destructive"
      onConfirm={async () => {
        if (revokeId) {
          await handleRevoke(revokeId);
          setRevokeId(null);
        }
        setRevokeOpen(false);
      }}
      theme={theme}
    />

    <ConfirmationDialog
      open={deleteUserOpen}
      onOpenChange={setDeleteUserOpen}
      title="Delete User"
      description="This will permanently delete the user account. This action cannot be undone."
      confirmText="Delete User"
      variant="destructive"
      onConfirm={async () => {
        await handleDeleteUser();
        setDeleteUserOpen(false);
      }}
      theme={theme}
    />

    <ConfirmationDialog
      open={banUserOpen}
      onOpenChange={setBanUserOpen}
      title="Ban User"
      description="Ban this user from signing in. You can unban later."
      confirmText="Ban User"
      variant="destructive"
      onConfirm={async () => {
        await handleBanUser();
        setBanUserOpen(false);
      }}
      theme={theme}
    />

    {/* Custom Ban Dialog with Duration Input */}
    <Dialog open={banUserOpen} onOpenChange={setBanUserOpen}>
      <DialogContent className={`sm:max-w-md ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}>
        <DialogHeader>
          <DialogTitle>Ban User</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="banHours">Ban Duration (hours)</Label>
            <Input
              id="banHours"
              type="number"
              min="1"
              max="8760"
              value={banHours}
              onChange={(e) => setBanHours(Math.max(1, parseInt(e.target.value) || 24))}
              className="mt-1"
            />
            <p className="text-sm text-gray-500 mt-1">
              User will be banned until: {new Date(Date.now() + banHours * 60 * 60 * 1000).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button 
              variant="destructive" 
              className="flex-1" 
              onClick={async () => {
                await handleBanUser();
                setBanUserOpen(false);
              }}
            >
              Ban User
            </Button>
            <Button variant="outline" onClick={() => setBanUserOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <ConfirmationDialog
      open={resetOpen}
      onOpenChange={setResetOpen}
      title="Send Password Reset"
      description="Send a password reset email to this user?"
      confirmText="Send"
      variant="default"
      onConfirm={async () => {
        await handleResetPassword();
        setResetOpen(false);
      }}
      theme={theme}
    />

    <ConfirmationDialog
      open={unbanUserOpen}
      onOpenChange={setUnbanUserOpen}
      title="Unban User"
      description="Allow this user to sign in again?"
      confirmText="Unban User"
      variant="default"
      onConfirm={async () => {
        await handleUnbanUser();
        setUnbanUserOpen(false);
      }}
      theme={theme}
    />
    </>
  );
}
