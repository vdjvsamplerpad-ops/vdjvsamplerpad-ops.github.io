import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Trash2, Download, Crown } from 'lucide-react';
import { SamplerBank, PadData } from './types/sampler';
import { useAuth } from '@/hooks/useAuth';
import { isReservedShortcutCombo, normalizeShortcutKey, normalizeStoredShortcutKey, RESERVED_SHORTCUT_KEYS } from '@/lib/keyboard-shortcuts';
import { MidiMessage } from '@/lib/midi';
import { LED_COLOR_PALETTE } from '@/lib/led-colors';

interface BankEditDialogProps {
  bank: SamplerBank;
  allBanks: SamplerBank[];
  allPads: PadData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: 'light' | 'dark';
  onSave: (updates: Partial<SamplerBank>) => void;
  onDelete: () => void;
  onExport: () => void;
  onClearPadShortcuts?: () => void;
  onClearPadMidi?: () => void;
  onExportAdmin?: (id: string, title: string, description: string, transferable: boolean, addToDatabase: boolean, allowExport: boolean, onProgress?: (progress: number) => void) => Promise<string>;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
}

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
  'Deep Brown 2'
];

const getContrastText = (hex: string) => {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '#ffffff';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
};

const colorOptions = BANK_COLOR_NAMES
  .map((name) => LED_COLOR_PALETTE.find((entry) => entry.name === name))
  .filter(Boolean)
  .map((entry) => ({
    label: entry!.name,
    value: entry!.hex,
    textColor: getContrastText(entry!.hex)
  }));

export function BankEditDialog({
  bank,
  allBanks,
  allPads,
  open,
  onOpenChange,
  theme,
  onSave,
  onDelete,
  onExport,
  onClearPadShortcuts,
  onClearPadMidi,
  onExportAdmin,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs
}: BankEditDialogProps) {
  type BankWithMidi = SamplerBank & { midiNote?: number; midiCC?: number };
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  const { profile } = useAuth();
  const [name, setName] = React.useState(bank.name);
  const [defaultColor, setDefaultColor] = React.useState(bank.defaultColor);
  const [shortcutKey, setShortcutKey] = React.useState(bank.shortcutKey || '');
  const [shortcutError, setShortcutError] = React.useState<string | null>(null);
  const [midiError, setMidiError] = React.useState<string | null>(null);
  const [midiNote, setMidiNote] = React.useState<number | undefined>((bank as BankWithMidi).midiNote);
  const [midiCC, setMidiCC] = React.useState<number | undefined>((bank as BankWithMidi).midiCC);
  const [midiLearnActive, setMidiLearnActive] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showAdminExport, setShowAdminExport] = React.useState(false);
  const [adminTitle, setAdminTitle] = React.useState(bank.name);
  const [adminDescription, setAdminDescription] = React.useState('');
  const [adminTransferable, setAdminTransferable] = React.useState(false);
  const [adminAddToDatabase, setAdminAddToDatabase] = React.useState(false);
  const [adminAllowExport, setAdminAllowExport] = React.useState(false);
  const [showAdminExportProgress, setShowAdminExportProgress] = React.useState(false);
  const [adminExportProgress, setAdminExportProgress] = React.useState(0);
  const [adminExportStatus, setAdminExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [adminExportError, setAdminExportError] = React.useState<string>('');

  React.useEffect(() => {
    if (open) {
      setName(bank.name);
      setDefaultColor(bank.defaultColor);
      setShortcutKey(bank.shortcutKey || '');
      setShortcutError(null);
      setMidiNote((bank as BankWithMidi).midiNote);
      setMidiCC((bank as BankWithMidi).midiCC);
      setMidiLearnActive(false);
      setMidiError(null);
      setAdminTitle(bank.name);
      setAdminDescription('');
      setAdminTransferable(false);
      setAdminAddToDatabase(false);
      setAdminAllowExport(true); // Default to true when Add to Database is disabled
    }
  }, [open, bank]);

  const formatShortcutForDisplay = React.useCallback(
    (storedKey?: string | null) => {
      if (!storedKey) return null;
      if (!storedKey.includes('+')) {
        return normalizeShortcutKey(storedKey) || storedKey;
      }
      const parts = storedKey.split('+').map((part) => part.trim()).filter(Boolean);
      const modifiers = new Set<string>();
      let mainKey = '';
      parts.forEach((part) => {
        const lower = part.toLowerCase();
        if (lower === 'shift') modifiers.add('shift');
        else if (lower === 'ctrl' || lower === 'control') modifiers.add('ctrl');
        else if (lower === 'alt' || lower === 'option') modifiers.add('alt');
        else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') modifiers.add('meta');
        else mainKey = part;
      });
      const displayKey = normalizeShortcutKey(mainKey) || mainKey;
      if (isMac) {
        const order = ['meta', 'ctrl', 'alt', 'shift'] as const;
        const symbols: Record<string, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
        return `${order.filter((key) => modifiers.has(key)).map((key) => symbols[key]).join('')}${displayKey}`;
      }
      const order = ['ctrl', 'alt', 'shift', 'meta'] as const;
      const labels: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta' };
      const prefix = order.filter((key) => modifiers.has(key)).map((key) => labels[key]);
      return [...prefix, displayKey].filter(Boolean).join('+');
    },
    [isMac]
  );

  React.useEffect(() => {
    if (!midiLearnActive) return;

    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (detail.type === 'noteon') {
        if (blockedMidiNotes?.has(detail.note)) {
          setMidiError('That MIDI note is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((otherBank) => {
          if (otherBank.id === bank.id) return false;
          const otherNote = (otherBank as BankWithMidi).midiNote;
          return typeof otherNote === 'number' && otherNote === detail.note;
        });
        if (duplicateBank) {
          setMidiError(`That MIDI note is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = allPads.find((pad) => typeof pad.midiNote === 'number' && pad.midiNote === detail.note);
        if (duplicatePad) {
          setMidiError(`That MIDI note is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiNote(detail.note);
      } else if (detail.type === 'cc') {
        if (blockedMidiCCs?.has(detail.cc)) {
          setMidiError('That MIDI CC is already assigned.');
          setMidiLearnActive(false);
          return;
        }
        const duplicateBank = allBanks.find((otherBank) => {
          if (otherBank.id === bank.id) return false;
          const otherCC = (otherBank as BankWithMidi).midiCC;
          return typeof otherCC === 'number' && otherCC === detail.cc;
        });
        if (duplicateBank) {
          setMidiError(`That MIDI CC is already assigned to bank "${duplicateBank.name}".`);
          setMidiLearnActive(false);
          return;
        }
        const duplicatePad = allPads.find((pad) => typeof pad.midiCC === 'number' && pad.midiCC === detail.cc);
        if (duplicatePad) {
          setMidiError(`That MIDI CC is already assigned to pad "${duplicatePad.name}".`);
          setMidiLearnActive(false);
          return;
        }
        setMidiCC(detail.cc);
      } else {
        return;
      }
      setMidiLearnActive(false);
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [midiLearnActive, allBanks, allPads, bank, blockedMidiNotes, blockedMidiCCs]);

  const handleSave = () => {
    if (shortcutError) {
      return;
    }

    onSave({
      name,
      defaultColor,
      shortcutKey: shortcutKey || undefined,
      midiNote,
      midiCC,
    });
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete();
    setShowDeleteConfirm(false);
  };

  const handleAdminExport = async () => {
    if (!onExportAdmin) return;

    setShowAdminExportProgress(true);
    setAdminExportStatus('loading');
    setAdminExportProgress(0);
    setAdminExportError('');

    try {
      const exportMessage = await onExportAdmin(bank.id, adminTitle, adminDescription, adminTransferable, adminAddToDatabase, adminAllowExport, (progress) => {
        setAdminExportProgress(progress);
      });
      setAdminExportStatus('success');
      // Store the message to show in ProgressDialog (reuse errorMessage field for success message)
      setAdminExportError(exportMessage || '');
    } catch (error) {
      console.error('Admin export failed:', error);
      setAdminExportStatus('error');
      setAdminExportError(error instanceof Error ? error.message : 'Admin export failed');
    }
  };

  const isAdmin = profile?.role === 'admin';

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const applyShortcutKey = (nextKey: string | null) => {
    if (!nextKey) {
      setShortcutKey('');
      setShortcutError(null);
      return;
    }

    if (isReservedShortcutCombo(nextKey)) {
      setShortcutError(`"${nextKey}" is reserved for global controls.`);
      return;
    }

    if (blockedShortcutKeys?.has(nextKey)) {
      setShortcutError(`"${nextKey}" is already assigned to system or channel mapping.`);
      return;
    }

    const duplicateBank = allBanks.find((otherBank) => {
      if (otherBank.id === bank.id) return false;
      const existingKey = normalizeStoredShortcutKey(otherBank.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicateBank) {
      setShortcutError(`"${nextKey}" is already assigned to bank "${duplicateBank.name}".`);
      return;
    }

    const duplicatePad = allPads.find((pad) => {
      const existingKey = normalizeStoredShortcutKey(pad.shortcutKey);
      return existingKey === nextKey;
    });

    if (duplicatePad) {
      setShortcutError(`"${nextKey}" is already assigned to pad "${duplicatePad.name}".`);
      return;
    }

    setMidiError(null);

    setShortcutKey(nextKey);
    setShortcutError(null);
  };

  const handleShortcutKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();

    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Escape') {
      applyShortcutKey(null);
      return;
    }

    if (event.shiftKey) {
      setShortcutError('Shift is reserved for the secondary bank.');
      return;
    }
    if (event.ctrlKey) {
      setShortcutError('Ctrl shortcuts are reserved by the browser. Use Alt or Meta instead.');
      return;
    }

    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      code: event.code
    });
    if (!normalized) {
      setShortcutError('Please press a letter or number key.');
      return;
    }

    applyShortcutKey(normalized);
  };

  const reservedKeysText = RESERVED_SHORTCUT_KEYS.join(', ');

  const shortcutAssignments = React.useMemo(() => {
    return bank.pads
      .map((pad) => ({
        name: pad.name,
        key: pad.shortcutKey ? formatShortcutForDisplay(pad.shortcutKey) : null,
        midi:
          typeof pad.midiNote === 'number'
            ? `Note ${pad.midiNote}`
            : typeof pad.midiCC === 'number'
              ? `CC ${pad.midiCC}`
              : null
      }))
      .filter((pad) => !!pad.key || !!pad.midi) as { name: string; key: string | null; midi: string | null }[];
  }, [bank.pads, formatShortcutForDisplay]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={`sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit Bank</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
 

            <div className="space-y-2">
              <Label>Bank Color</Label>
              <div className="flex gap-1 flex-wrap">
                {colorOptions.map((colorOption) => (
                  <button
                    key={colorOption.value}
                    onClick={() => setDefaultColor(colorOption.value)}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${defaultColor === colorOption.value ? 'border-white scale-110 shadow-lg' : 'border-gray-400'
                      }`}
                    style={{ 
                      backgroundColor: colorOption.value,
                      color: colorOption.textColor
                    }}
                    title={colorOption.label}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Bank Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => {
                  if (e.target.value.length <= 18) {
                    setName(e.target.value);
                  }
                }}
                placeholder="Enter bank name"
                className="backdrop-blur-sm"
                maxLength={24}
                autoComplete="off"
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

            <div className={`grid gap-3 ${midiEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="space-y-2">
                <Label htmlFor="bankShortcutKey">Bank Shortcut Key</Label>
                <Input
                  id="bankShortcutKey"
                  value={shortcutKey}
                  onKeyDown={handleShortcutKeyDown}
                  placeholder="Press a key"
                  readOnly
                />
                {shortcutError && (
                  <p className="text-xs text-red-500">{shortcutError}</p>
                )}
                {!shortcutError && (
                  <p className="text-xs text-gray-500">
                    Reserved keys: {reservedKeysText}
                  </p>
                )}
              </div>

              {midiEnabled && (
                <div className="space-y-2">
                  <Label>MIDI Assignment</Label>
                  <div className="text-xs text-gray-500">
                    Note: {midiNote ?? '—'} | CC: {midiCC ?? '—'}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setMidiLearnActive(true)}
                      className="flex-1"
                    >
                      {midiLearnActive ? 'Listening…' : 'Learn MIDI'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setMidiNote(undefined);
                        setMidiCC(undefined);
                        setMidiLearnActive(false);
                        setMidiError(null);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  {midiError && <p className="text-xs text-red-500">{midiError}</p>}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Pad Shortcuts (Keyboard/MIDI)</Label>
                <div className="flex items-center gap-2">
                  {onClearPadShortcuts && (
                    <Button type="button" variant="outline" size="sm" onClick={onClearPadShortcuts}>
                      Clear All Keys
                    </Button>
                  )}
                  {midiEnabled && onClearPadMidi && (
                    <Button type="button" variant="outline" size="sm" onClick={onClearPadMidi}>
                      Clear All MIDI
                    </Button>
                  )}
                </div>
              </div>
              {shortcutAssignments.length > 0 ? (
                <div className="max-h-32 overflow-y-auto rounded border p-2 text-sm">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] uppercase tracking-wide text-gray-500">
                    <div>Pad</div>
                    <div>Key</div>
                    <div>MIDI</div>
                  </div>
                  <div className="mt-1 space-y-1">
                    {shortcutAssignments.map((assignment, index) => (
                      <div key={`${assignment.name}-${assignment.key ?? 'none'}-${assignment.midi ?? 'none'}-${index}`} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                        <span className="truncate">{assignment.name}</span>
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                          {assignment.key ?? '—'}
                        </span>
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-800 dark:bg-gray-700 dark:text-gray-100">
                          {assignment.midi ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-500">No shortcuts assigned in this bank.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Bank Information</Label>
              <div className={`text-sm space-y-1 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                <div>Created: {formatDate(bank.createdAt)}</div>
                <div>Pads: {bank.pads.length}</div>
                <div>Created by: {bank.isAdminBank ? (
                  <span className="text-yellow-500 font-medium">ADMIN DJ V</span>
                ) : bank.creatorEmail ? (
                  <span>{bank.creatorEmail}</span>
                ) : (
                  <span className="italic text-gray-400">Unknown</span>
                )}</div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button onClick={handleSave} className="flex-1">
                Save Changes
              </Button>
              <Button
                onClick={() => {
                  // Block export if exportable is false
                  if (bank.exportable === false) {
                    return;
                  }
                  if (isAdmin && onExportAdmin) {
                    setShowAdminExport(true);
                  } else {
                    onExport();
                  }
                }}
                variant="outline"
                disabled={bank.exportable === false}
                className={`px-3 ${bank.exportable === false ? 'opacity-50 cursor-not-allowed' : ''}`}
                title={bank.exportable === false ? 'Export disabled for this bank' : (isAdmin ? 'Export (admin)' : 'Export')}
              >
                <Download className="w-4 h-4" />
              </Button>
              <Button onClick={handleDeleteClick} variant="destructive" className="px-3">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Bank"
        description={`Are you sure you want to delete the bank "${bank.name}"? This will permanently delete all pads in this bank. This action cannot be undone.`}
        confirmText="Delete Bank"
        variant="destructive"
        onConfirm={handleConfirmDelete}
        theme={theme}
      />

      {/* Admin Export Dialog */}
      <Dialog open={showAdminExport} onOpenChange={setShowAdminExport}>
        <DialogContent className={`sm:max-w-md backdrop-blur-md ${theme === 'dark' ? 'bg-gray-800/90' : 'bg-white/90'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="w-4 h-4" />
              Export as Admin Bank
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="adminTitle">Bank Title</Label>
              <Input
                id="adminTitle"
                value={adminTitle}
                onChange={(e) => setAdminTitle(e.target.value)}
                placeholder="Enter bank title"
                className="backdrop-blur-sm"
                maxLength={50}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminDescription">Description</Label>
              <textarea
                id="adminDescription"
                value={adminDescription}
                onChange={(e) => setAdminDescription(e.target.value)}
                placeholder="Enter bank description"
                className={`w-full min-h-[80px] p-3 rounded-md border backdrop-blur-sm resize-none ${
                  theme === 'dark' 
                    ? 'bg-gray-700/50 border-gray-600 text-white placeholder-gray-400' 
                    : 'bg-white/50 border-gray-300 text-gray-900 placeholder-gray-500'
                }`}
                maxLength={200}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="adminTransferable">Allow Pad Transfers</Label>
              <Switch
                id="adminTransferable"
                checked={adminTransferable}
                onCheckedChange={setAdminTransferable}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="adminAddToDatabase">Add to Database</Label>
                <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                  Official bank with user access control (export automatically disabled)
                </p>
              </div>
              <Switch
                id="adminAddToDatabase"
                checked={adminAddToDatabase}
                onCheckedChange={(checked) => {
                  setAdminAddToDatabase(checked);
                  if (checked) {
                    // When Add to Database is enabled, export is automatically blocked
                    setAdminAllowExport(false);
                  }
                }}
              />
            </div>

            {!adminAddToDatabase && (
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="adminAllowExport">Allow Export</Label>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    Users can export this bank after importing
                  </p>
                </div>
                <Switch
                  id="adminAllowExport"
                  checked={adminAllowExport}
                  onCheckedChange={setAdminAllowExport}
                />
              </div>
            )}

            <div className="flex gap-2 pt-4">
              <Button onClick={handleAdminExport} className="flex-1" disabled={!adminTitle.trim()}>
                Export Admin Bank
              </Button>
              <Button onClick={() => setShowAdminExport(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Export Progress Dialog */}
      <ProgressDialog
        open={showAdminExportProgress}
        onOpenChange={(open) => {
          setShowAdminExportProgress(open);
          if (!open && adminExportStatus === 'success') {
            setShowAdminExport(false);
          }
        }}
        title="Exporting Admin Bank"
        description="Creating encrypted bank file and updating database..."
        progress={adminExportProgress}
        status={adminExportStatus}
        type="export"
        theme={theme}
        errorMessage={adminExportError}
        onRetry={handleAdminExport}
      />

    </>
  );
}
