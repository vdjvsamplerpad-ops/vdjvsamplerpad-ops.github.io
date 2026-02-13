import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MidiInputInfo, MidiMessage } from '@/lib/midi';
import { MidiDeviceProfile } from '@/lib/midi/device-profiles';
import { DEFAULT_SYSTEM_MAPPINGS, SystemAction, SystemMappings, SYSTEM_ACTION_LABELS } from '@/lib/system-mappings';
import { normalizeShortcutKey } from '@/lib/keyboard-shortcuts';

const DEFAULT_DESCRIPTION =
  'VDJV Sampler Pad is a fast, performance-ready sampler for launching audio clips, banks, and live mixes across web and mobile.';

const SYSTEM_COLOR_OPTIONS = [
  { name: 'Red', hex: '#ff0000' },
  { name: 'Orange', hex: '#ff5400' },
  { name: 'Warm Yellow', hex: '#ffbd6c' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Yellow Green', hex: '#bdff2d' },
  { name: 'Lime', hex: '#54ff00' },
  { name: 'Green', hex: '#00ff00' },
  { name: 'Cyan', hex: '#4cc3ff' },
  { name: 'Blue', hex: '#0000ff' },
  { name: 'Purple', hex: '#5400ff' },
  { name: 'Pink', hex: '#ff00ff' },
  { name: 'White', hex: '#ffffff' }
];


interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  version: string;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiAccessGranted: boolean;
  midiBackend: 'web' | 'native';
  midiOutputSupported: boolean;
  midiInputs: MidiInputInfo[];
  midiSelectedInputId: string | null;
  midiError: string | null;
  onRequestMidiAccess: () => void;
  onSelectMidiInput: (id: string | null) => void;
  onToggleMidiEnabled: (enabled: boolean) => void;
  systemMappings: SystemMappings;
  onUpdateSystemKey: (action: SystemAction, key: string) => void;
  onResetSystemKey: (action: SystemAction) => void;
  onUpdateSystemMidi: (action: SystemAction, midiNote?: number, midiCC?: number) => void;
  onUpdateSystemColor: (action: SystemAction, color?: string) => void;
  onSetMasterVolumeCC: (cc?: number) => void;
  onUpdateChannelMapping: (channelIndex: number, updates: Partial<{ keyUp?: string; keyDown?: string; keyStop?: string; midiCC?: number; midiNote?: number }>) => void;
  padBankShortcutKeys: Set<string>;
  padBankMidiNotes: Set<number>;
  padBankMidiCCs: Set<number>;
  midiNoteAssignments: Array<{ note: number; type: 'pad' | 'bank'; bankName: string; padName?: string }>;
  hideShortcutLabels: boolean;
  onToggleHideShortcutLabels: (hide: boolean) => void;
  sidePanelMode: 'overlay' | 'reflow';
  onChangeSidePanelMode: (mode: 'overlay' | 'reflow') => void;
  onResetAllSystemMappings: () => void;
  onClearAllSystemMappings: () => void;
  onResetAllChannelMappings: () => void;
  onClearAllChannelMappings: () => void;
  midiDeviceProfiles: MidiDeviceProfile[];
  midiDeviceProfileId: string | null;
  onSelectMidiDeviceProfile: (id: string | null) => void;
  onExportMappings: () => Promise<string>;
  onImportMappings: (file: File) => Promise<string>;
}

export function AboutDialog({
  open,
  onOpenChange,
  displayName,
  version,
  midiSupported,
  midiEnabled,
  midiAccessGranted,
  midiBackend,
  midiOutputSupported,
  midiInputs,
  midiSelectedInputId,
  midiError,
  onRequestMidiAccess,
  onSelectMidiInput,
  onToggleMidiEnabled,
  systemMappings,
  onUpdateSystemKey,
  onResetSystemKey,
  onUpdateSystemMidi,
  onUpdateSystemColor,
  onSetMasterVolumeCC,
  onUpdateChannelMapping,
  padBankShortcutKeys,
  padBankMidiNotes,
  padBankMidiCCs,
  midiNoteAssignments,
  hideShortcutLabels,
  onToggleHideShortcutLabels,
  sidePanelMode,
  onChangeSidePanelMode,
  onResetAllSystemMappings,
  onClearAllSystemMappings,
  onResetAllChannelMappings,
  onClearAllChannelMappings,
  midiDeviceProfiles,
  midiDeviceProfileId,
  onSelectMidiDeviceProfile,
  onExportMappings,
  onImportMappings
}: AboutDialogProps) {
  const [midiLearnAction, setMidiLearnAction] = React.useState<
    | { type: 'system'; action: SystemAction }
    | { type: 'channel'; channelIndex: number }
    | { type: 'masterVolume' }
    | null
  >(null);
  const [mappingError, setMappingError] = React.useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) {
      setMidiLearnAction(null);
      setMappingError(null);
      setMappingNotice(null);
    }
  }, [open]);

  const channelMappings = systemMappings.channelMappings || [];
  const systemActionKeys = React.useMemo(() => Object.keys(SYSTEM_ACTION_LABELS) as SystemAction[], []);
  const midiNoteAssignmentMap = React.useMemo(() => {
    const map = new Map<number, { type: 'pad' | 'bank'; bankName: string; padName?: string }>();
    midiNoteAssignments.forEach((entry) => {
      if (!map.has(entry.note)) {
        map.set(entry.note, { type: entry.type, bankName: entry.bankName, padName: entry.padName });
      }
    });
    return map;
  }, [midiNoteAssignments]);

  const describeMidiNoteConflict = React.useCallback((
    note: number,
    options?: { excludeAction?: SystemAction; excludeChannelIndex?: number }
  ) => {
    const assignment = midiNoteAssignmentMap.get(note);
    if (assignment) {
      if (assignment.type === 'pad') {
        return `pad "${assignment.padName || 'Unnamed'}" in bank "${assignment.bankName}"`;
      }
      return `bank "${assignment.bankName}"`;
    }

    const systemAction = systemActionKeys.find(
      (action) => action !== options?.excludeAction && systemMappings[action]?.midiNote === note
    );
    if (systemAction) {
      return `system mapping "${SYSTEM_ACTION_LABELS[systemAction]}"`;
    }

    const channelIndex = channelMappings.findIndex(
      (mapping, index) => index !== options?.excludeChannelIndex && mapping?.midiNote === note
    );
    if (channelIndex >= 0) {
      return `Channel ${channelIndex + 1} Stop`;
    }

    return null;
  }, [channelMappings, midiNoteAssignmentMap, systemActionKeys, systemMappings]);

  const isSystemKeyUsed = React.useCallback(
    (key: string, excludeAction?: SystemAction) => {
      return systemActionKeys
        .filter((action) => action !== excludeAction)
        .some((action) => systemMappings[action]?.key === key);
    },
    [systemMappings, systemActionKeys]
  );

  const isChannelKeyUsed = React.useCallback(
    (key: string, excludeIndex?: number, excludeField?: 'keyUp' | 'keyDown' | 'keyStop') => {
      return channelMappings.some((mapping, index) => {
        if (!mapping) return false;
        if (excludeIndex === index) {
          if (excludeField && mapping[excludeField] === key) return false;
        }
        return mapping.keyUp === key || mapping.keyDown === key || mapping.keyStop === key;
      });
    },
    [channelMappings]
  );

  const isSystemMidiNoteUsed = React.useCallback(
    (note: number, excludeAction?: SystemAction) => {
      return systemActionKeys
        .filter((action) => action !== excludeAction)
        .some((action) => systemMappings[action]?.midiNote === note);
    },
    [systemMappings, systemActionKeys]
  );

  const isSystemMidiCCUsed = React.useCallback(
    (cc: number, excludeAction?: SystemAction) => {
      if (excludeAction !== undefined) {
        return systemActionKeys
          .filter((action) => action !== excludeAction)
          .some((action) => systemMappings[action]?.midiCC === cc);
      }
      return systemActionKeys.some((action) => systemMappings[action]?.midiCC === cc);
    },
    [systemMappings, systemActionKeys]
  );

  const isChannelMidiNoteUsed = React.useCallback(
    (note: number, excludeIndex?: number) => {
      return channelMappings.some((mapping, index) => {
        if (!mapping || typeof mapping.midiNote !== 'number') return false;
        if (excludeIndex === index) return false;
        return mapping.midiNote === note;
      });
    },
    [channelMappings]
  );

  const isChannelMidiCCUsed = React.useCallback(
    (cc: number, excludeIndex?: number) => {
      return channelMappings.some((mapping, index) => {
        if (!mapping || typeof mapping.midiCC !== 'number') return false;
        if (excludeIndex === index) return false;
        return mapping.midiCC === cc;
      });
    },
    [channelMappings]
  );

  React.useEffect(() => {
    if (!midiLearnAction) return;
    const handleMidiEvent = (event: Event) => {
      const detail = (event as CustomEvent<MidiMessage>).detail;
      if (!detail) return;

      if (midiLearnAction.type === 'masterVolume') {
        if (detail.type === 'cc') {
          if (padBankMidiCCs.has(detail.cc) || isChannelMidiCCUsed(detail.cc) || isSystemMidiCCUsed(detail.cc)) {
            setMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onSetMasterVolumeCC(detail.cc);
          setMappingError(null);
          setMidiLearnAction(null);
        }
        return;
      }

      if (midiLearnAction.type === 'system') {
        if (detail.type === 'noteon') {
          if (padBankMidiNotes.has(detail.note) || isChannelMidiNoteUsed(detail.note) || isSystemMidiNoteUsed(detail.note, midiLearnAction.action)) {
            const conflict = describeMidiNoteConflict(detail.note, { excludeAction: midiLearnAction.action });
            setMappingError(conflict ? `That MIDI note is already assigned to ${conflict}.` : 'That MIDI note is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateSystemMidi(midiLearnAction.action, detail.note, undefined);
          setMappingError(null);
          setMidiLearnAction(null);
        } else if (detail.type === 'cc') {
          if (midiLearnAction.action === 'midiShift') {
            setMappingError('MIDI Shift must use a MIDI note.');
            setMidiLearnAction(null);
            return;
          }
          if (padBankMidiCCs.has(detail.cc) || isChannelMidiCCUsed(detail.cc) || isSystemMidiCCUsed(detail.cc, midiLearnAction.action)) {
            setMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateSystemMidi(midiLearnAction.action, undefined, detail.cc);
          setMappingError(null);
          setMidiLearnAction(null);
        }
        return;
      }

      if (midiLearnAction.type === 'channel') {
        if (detail.type === 'cc') {
          if (padBankMidiCCs.has(detail.cc) || isSystemMidiCCUsed(detail.cc) || isChannelMidiCCUsed(detail.cc, midiLearnAction.channelIndex)) {
            setMappingError('That MIDI CC is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateChannelMapping(midiLearnAction.channelIndex, { midiCC: detail.cc });
          setMappingError(null);
          setMidiLearnAction(null);
          return;
        }
        if (detail.type === 'noteon') {
          if (padBankMidiNotes.has(detail.note) || isSystemMidiNoteUsed(detail.note) || isChannelMidiNoteUsed(detail.note, midiLearnAction.channelIndex)) {
            const conflict = describeMidiNoteConflict(detail.note, { excludeChannelIndex: midiLearnAction.channelIndex });
            setMappingError(conflict ? `That MIDI note is already assigned to ${conflict}.` : 'That MIDI note is already assigned.');
            setMidiLearnAction(null);
            return;
          }
          onUpdateChannelMapping(midiLearnAction.channelIndex, { midiNote: detail.note });
          setMappingError(null);
          setMidiLearnAction(null);
          return;
        }
        setMidiLearnAction(null);
      }
    };

    window.addEventListener('vdjv-midi', handleMidiEvent as EventListener);
    return () => window.removeEventListener('vdjv-midi', handleMidiEvent as EventListener);
  }, [
    midiLearnAction,
    onSetMasterVolumeCC,
    onUpdateSystemMidi,
    onUpdateChannelMapping,
    padBankMidiNotes,
    padBankMidiCCs,
    isChannelMidiNoteUsed,
    isChannelMidiCCUsed,
    isSystemMidiNoteUsed,
    isSystemMidiCCUsed,
    describeMidiNoteConflict
  ]);

  const handleKeyAssign = (action: SystemAction) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (event.key === 'Escape') return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      onUpdateSystemKey(action, '');
      setMappingError(null);
      return;
    }
    const normalized = normalizeShortcutKey(event.key, {
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
    if (normalized) {
      if (systemMappings[action]?.key === normalized) {
        setMappingError(null);
        return;
      }
      if (padBankShortcutKeys.has(normalized) || isChannelKeyUsed(normalized) || isSystemKeyUsed(normalized, action)) {
        setMappingError('That key is already assigned.');
        return;
      }
      onUpdateSystemKey(action, normalized);
      setMappingError(null);
    }
  };

  const systemActions: SystemAction[] = [
    'stopAll',
    'mixer',
    'editMode',
    'banksMenu',
    'nextBank',
    'prevBank',
    'upload',
    'padSizeUp',
    'padSizeDown',
    'importBank',
    'toggleTheme',
    'activateSecondary',
    'midiShift'
  ];

  const handleChannelKeyAssign = (channelIndex: number, field: 'keyUp' | 'keyDown' | 'keyStop') =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape') return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onUpdateChannelMapping(channelIndex, { [field]: '' });
        setMappingError(null);
        return;
      }
      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
      metaKey: event.metaKey,
      code: event.code
      });
      if (normalized) {
        const currentValue = channelMappings[channelIndex]?.[field];
        if (currentValue === normalized) {
          setMappingError(null);
          return;
        }
        if (padBankShortcutKeys.has(normalized) || isSystemKeyUsed(normalized) || isChannelKeyUsed(normalized, channelIndex, field)) {
          setMappingError('That key is already assigned.');
          return;
        }
        onUpdateChannelMapping(channelIndex, { [field]: normalized });
        setMappingError(null);
      }
    };

  const handleMasterKeyAssign = (field: 'volumeUp' | 'volumeDown' | 'mute') =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Tab') return;
      event.preventDefault();
      if (event.key === 'Escape') return;
      if (event.key === 'Backspace' || event.key === 'Delete') {
        onUpdateSystemKey(field, '');
        setMappingError(null);
        return;
      }
      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        code: event.code
      });
      if (normalized) {
        if (systemMappings[field]?.key === normalized) {
          setMappingError(null);
          return;
        }
        if (padBankShortcutKeys.has(normalized) || isChannelKeyUsed(normalized) || isSystemKeyUsed(normalized, field)) {
          setMappingError('That key is already assigned.');
          return;
        }
        onUpdateSystemKey(field, normalized);
        setMappingError(null);
      }
    };

  const handleExportMappings = React.useCallback(async () => {
    try {
      const message = await onExportMappings();
      setMappingNotice({ type: 'success', message });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed.';
      setMappingNotice({ type: 'error', message });
    }
  }, [onExportMappings]);

  const handleImportClick = React.useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportMappings = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const message = await onImportMappings(file);
        setMappingNotice({ type: 'success', message });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed.';
        setMappingNotice({ type: 'error', message });
      }
    },
    [onImportMappings]
  );

  const showColorColumn = midiEnabled;
  const showMidiColumn = midiAccessGranted;
  const systemGridCols = showMidiColumn
    ? (showColorColumn ? 'sm:grid-cols-4' : 'sm:grid-cols-3')
    : (showColorColumn ? 'sm:grid-cols-3' : 'sm:grid-cols-2');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-h-[90vh] overflow-y-auto sm:max-w-lg backdrop-blur-md bg-white/95 border-gray-300 dark:bg-gray-800/95 dark:border-gray-600">
        <DialogHeader>
          <DialogTitle>VDJV Sampler Pad</DialogTitle>
          <DialogDescription>{DEFAULT_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">User</div>
              <div className="font-medium">{displayName}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Version</div>
              <div className="font-medium">{version}</div>
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">MIDI</div>
            {!midiSupported && (
              <p className="text-xs text-red-500">Web MIDI not supported in this browser.</p>
            )}
            {midiSupported && (
              <div className="flex items-center justify-between">
                <Label className="text-xs">Enable MIDI Input</Label>
                <Switch checked={midiEnabled} onCheckedChange={onToggleMidiEnabled} disabled={!midiSupported} />
              </div>
            )}
            {midiSupported && midiEnabled && midiAccessGranted && (
              <div className="space-y-2">
                <div className="text-[10px] text-gray-500">
                  Backend: {midiBackend === 'native' ? 'Native MIDI' : 'Web MIDI'}
                  {!midiOutputSupported && (
                    <span className="ml-2 text-red-500">LED output not available</span>
                  )}
                </div>
                {midiError && <p className="text-xs text-red-500">{midiError}</p>}
                <div className="space-y-1">
                  <Label className="text-xs">MIDI Input</Label>
                  <Select
                    value={midiSelectedInputId || ''}
                    onValueChange={(value) => onSelectMidiInput(value || null)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select device" />
                    </SelectTrigger>
                    <SelectContent>
                      {midiInputs.length === 0 && (
                        <SelectItem value="none" disabled>
                          No MIDI inputs
                        </SelectItem>
                      )}
                      {midiInputs.map((input) => (
                        <SelectItem key={input.id} value={input.id}>
                          {input.name || input.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Device Profile</Label>
                  <Select
                    value={midiDeviceProfileId || '__auto__'}
                    onValueChange={(value) => onSelectMidiDeviceProfile(value === '__auto__' ? null : value)}
                    disabled={!midiOutputSupported}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto-detect" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Auto-detect</SelectItem>
                      {midiDeviceProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Display</div>
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Hide keyboard shortcut text on pads</Label>
              <Switch checked={hideShortcutLabels} onCheckedChange={onToggleHideShortcutLabels} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Side Panel Behavior</Label>
              <Select
                value={sidePanelMode}
                onValueChange={(value) => onChangeSidePanelMode(value as 'overlay' | 'reflow')}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overlay">Overlay</SelectItem>
                  <SelectItem value="reflow">Reflow</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">System Mapping</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onResetAllSystemMappings}>
                  Reset All
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onClearAllSystemMappings}>
                  Clear All
                </Button>
              </div>
            </div>
            {mappingError && (
              <div className="text-xs text-red-500">{mappingError}</div>
            )}
            <div className={`grid gap-2 text-xs font-medium text-gray-500 grid-cols-1 ${systemGridCols}`}>
              <div>Function</div>
              <div>Keyboard</div>
              {showColorColumn && <div>Color</div>}
              {showMidiColumn && <div>MIDI</div>}
            </div>
            {systemActions.map((action) => {
              const mapping = systemMappings[action] as SystemMappings[SystemAction] & { color?: string };
              const hasMidi = mapping.midiNote !== undefined || mapping.midiCC !== undefined;
              return (
                <div key={action} className={`grid gap-2 items-center grid-cols-1 ${systemGridCols}`}>
                  <div className="text-xs text-gray-700 dark:text-gray-200">{SYSTEM_ACTION_LABELS[action]}</div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={mapping.key || ''}
                      onKeyDown={handleKeyAssign(action)}
                      placeholder={DEFAULT_SYSTEM_MAPPINGS[action].key}
                      readOnly
                      className="h-7 text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        onResetSystemKey(action);
                        onUpdateSystemMidi(action, undefined, undefined);
                      }}
                    >
                      Reset
                    </Button>
                  </div>
                  {showColorColumn && (
                    <Select
                      value={mapping.color || '__none__'}
                      onValueChange={(value) => onUpdateSystemColor(action, value === '__none__' ? undefined : value)}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {SYSTEM_COLOR_OPTIONS.map((entry) => (
                          <SelectItem key={entry.name} value={entry.hex}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {showMidiColumn && (
                    <div className="flex items-center gap-2">
                      {!hasMidi && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => setMidiLearnAction({ type: 'system', action })}
                        >
                          {midiLearnAction?.type === 'system' && midiLearnAction.action === action ? 'Listening…' : 'Learn'}
                        </Button>
                      )}
                      {hasMidi && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[10px]"
                          onClick={() => {
                            onUpdateSystemMidi(action, undefined, undefined);
                            setMappingError(null);
                          }}
                        >
                          Clear
                        </Button>
                      )}
                      <span className="text-xs text-gray-500">
                        {mapping.midiNote !== undefined
                          ? `Note ${mapping.midiNote}`
                          : mapping.midiCC !== undefined
                            ? `CC ${mapping.midiCC}`
                            : '—'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}

          </div>
          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs uppercase tracking-wide text-gray-500">Channel Mapping</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onResetAllChannelMappings}>
                  Reset All
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={onClearAllChannelMappings}>
                  Clear All
                </Button>
              </div>
            </div>
            <div className={`grid gap-2 text-xs font-medium text-gray-500 grid-cols-1 ${showMidiColumn ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
              <div>Channel</div>
              <div>Vol +</div>
              <div>Vol -</div>
              <div>Stop</div>
              {showMidiColumn && <div>MIDI CC</div>}
            </div>
            {(systemMappings.channelMappings || []).map((mapping, index) => (
              <div
                key={`channel-${index}`}
                className={`grid gap-2 items-center grid-cols-1 ${showMidiColumn ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}
              >
                <div className="text-xs text-gray-700 dark:text-gray-200">CH {index + 1}</div>
                <Input
                  value={mapping.keyUp || ''}
                  onKeyDown={handleChannelKeyAssign(index, 'keyUp')}
                  placeholder="—"
                  readOnly
                  className="h-7 text-xs"
                />
                <Input
                  value={mapping.keyDown || ''}
                  onKeyDown={handleChannelKeyAssign(index, 'keyDown')}
                  placeholder="—"
                  readOnly
                  className="h-7 text-xs"
                />
                <div className="flex flex-col gap-1">
                  <Input
                    value={mapping.keyStop || ''}
                    onKeyDown={handleChannelKeyAssign(index, 'keyStop')}
                    placeholder="—"
                    readOnly
                    className="h-6 text-[10px] px-2"
                  />
                  {showMidiColumn && (
                    <div className="flex items-center gap-1">
                      {mapping.midiNote === undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-1 text-[9px]"
                          onClick={() => setMidiLearnAction({ type: 'channel', channelIndex: index })}
                        >
                          {midiLearnAction?.type === 'channel' && midiLearnAction.channelIndex === index ? 'Listening…' : 'Learn Note'}
                        </Button>
                      )}
                      {mapping.midiNote !== undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-1 text-[9px]"
                          onClick={() => {
                            onUpdateChannelMapping(index, { midiNote: undefined });
                            setMappingError(null);
                          }}
                        >
                          Clear
                        </Button>
                      )}
                      <span className="text-[10px] text-gray-500">{mapping.midiNote ?? '—'}</span>
                    </div>
                  )}
                </div>
                {showMidiColumn && (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      {mapping.midiCC === undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-1 text-[9px]"
                          onClick={() => setMidiLearnAction({ type: 'channel', channelIndex: index })}
                        >
                          {midiLearnAction?.type === 'channel' && midiLearnAction.channelIndex === index ? 'Listening…' : 'Learn CC'}
                        </Button>
                      )}
                      {mapping.midiCC !== undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-1 text-[9px]"
                          onClick={() => {
                            onUpdateChannelMapping(index, { midiCC: undefined });
                            setMappingError(null);
                          }}
                        >
                          Clear
                        </Button>
                      )}
                      <span className="text-[10px] text-gray-500">
                        {mapping.midiCC ?? '—'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className={`grid gap-2 items-center grid-cols-1 ${showMidiColumn ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
              <div className="text-xs text-gray-700 dark:text-gray-200">Master</div>
              <Input
                value={systemMappings.volumeUp.key || ''}
                onKeyDown={handleMasterKeyAssign('volumeUp')}
                placeholder={DEFAULT_SYSTEM_MAPPINGS.volumeUp.key}
                readOnly
                className="h-7 text-xs"
              />
              <Input
                value={systemMappings.volumeDown.key || ''}
                onKeyDown={handleMasterKeyAssign('volumeDown')}
                placeholder={DEFAULT_SYSTEM_MAPPINGS.volumeDown.key}
                readOnly
                className="h-7 text-xs"
              />
              <div className="flex items-center gap-2">
                <Input
                  value={systemMappings.mute.key || ''}
                  onKeyDown={handleMasterKeyAssign('mute')}
                  placeholder={DEFAULT_SYSTEM_MAPPINGS.mute.key}
                  readOnly
                  className="h-7 text-xs"
                />
                {showMidiColumn && systemMappings.mute.midiNote === undefined && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => setMidiLearnAction({ type: 'system', action: 'mute' })}
                  >
                    {midiLearnAction?.type === 'system' && midiLearnAction.action === 'mute' ? 'Listening…' : 'Learn Note'}
                  </Button>
                )}
                {showMidiColumn && systemMappings.mute.midiNote !== undefined && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => {
                      onUpdateSystemMidi('mute', undefined, undefined);
                      setMappingError(null);
                    }}
                  >
                    Clear
                  </Button>
                )}
                {showMidiColumn && (
                  <span className="text-xs text-gray-500">{systemMappings.mute.midiNote ?? '—'}</span>
                )}
              </div>
              {showMidiColumn && (
                <div className="flex items-center gap-2">
                  {systemMappings.masterVolumeCC === undefined && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setMidiLearnAction({ type: 'masterVolume' })}
                    >
                      {midiLearnAction?.type === 'masterVolume' ? 'Listening…' : 'Learn CC'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[10px]"
                    onClick={() => onSetMasterVolumeCC(undefined)}
                  >
                    Clear
                  </Button>
                  <span className="text-xs text-gray-500">
                    {systemMappings.masterVolumeCC ?? '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Mapping Backup</div>
            {mappingNotice && (
              <div className={`text-xs ${mappingNotice.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {mappingNotice.message}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleExportMappings}>
                Export Mappings
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleImportClick}>
                Import Mappings
              </Button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImportMappings}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
