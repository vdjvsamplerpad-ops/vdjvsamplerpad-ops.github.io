import * as React from 'react';
import { PadGrid } from './PadGrid';
import { SideMenu } from './SideMenu';
import { HeaderControls } from './HeaderControls';
import { useSamplerStore } from './hooks/useSamplerStore';
import { useGlobalPlaybackManager } from './hooks/useGlobalPlaybackManager';
import { useTheme } from './hooks/useTheme';
import { useWindowSize } from './hooks/useWindowSize';
import { StopMode, PadData } from './types/sampler';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { normalizeShortcutKey, normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';
import { useWebMidi } from '@/lib/midi';
import { DEFAULT_SYSTEM_MAPPINGS, SystemAction, SystemMappings } from '@/lib/system-mappings';
import { LED_COLOR_OPTIONS } from '@/lib/led-colors';
import { getMidiDeviceProfile, getMidiDeviceProfileById, midiDeviceProfiles } from '@/lib/midi/device-profiles';
import { getCachedUser, useAuth } from '@/hooks/useAuth';

// Persistence key for app settings
const SETTINGS_STORAGE_KEY = 'vdjv-sampler-settings';

interface AppSettings {
  masterVolume: number;
  eqSettings: { low: number; mid: number; high: number };
  stopMode: StopMode;
  sideMenuOpen: boolean;
  mixerOpen: boolean;
  editMode: boolean;
  padSize: number;
  hideShortcutLabels: boolean;
  midiDeviceProfileId: string | null;
  systemMappings: SystemMappings;
}

type ChannelMappingEntry = { keyUp?: string; keyDown?: string; keyStop?: string; midiCC?: number; midiNote?: number };
type BankMappingValue = { shortcutKey: string; midiNote: number | null; midiCC: number | null; bankName?: string };
type PadMappingValue = { shortcutKey: string; midiNote: number | null; midiCC: number | null; padName?: string };
type MappingExport = {
  version: number;
  exportedAt: string;
  systemMappings: SystemMappings;
  channelMappings: ChannelMappingEntry[];
  bankShortcutKeys: Record<string, BankMappingValue>;
  padShortcutKeys: Record<string, Record<string, PadMappingValue>>;
};
const MAPPING_EXPORT_VERSION = 1;

const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);
  const capacitor = (window as any).Capacitor;
  return isAndroid && capacitor?.isNativePlatform?.() === true;
};

const saveMappingFile = async (blob: Blob, fileName: string): Promise<string> => {
  if (isNativeAndroid()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true
      });
      return `Mappings exported to Documents/${fileName}`;
    } catch (error) {
      console.error('Failed to save mappings using Capacitor Filesystem:', error);
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return `Mappings exported to selected path (${fileName})`;
};
type ExtendedSystemAction =
  | SystemAction
  | 'padSizeUp'
  | 'padSizeDown'
  | 'importBank'
  | 'toggleTheme'
  | 'activateSecondary';

const defaultSettings: AppSettings = {
  masterVolume: 1,
  eqSettings: { low: 0, mid: 0, high: 0 },
  stopMode: 'brake',
  sideMenuOpen: false,
  mixerOpen: false,
  editMode: false,
  padSize: 5,
  hideShortcutLabels: false,
  midiDeviceProfileId: null,
  systemMappings: DEFAULT_SYSTEM_MAPPINGS
};

export function SamplerPadApp() {
  type PadWithMidi = PadData & { midiNote?: number; midiCC?: number };
  const {
    banks,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    primaryBank,
    secondaryBank,
    currentBank,
    isDualMode,
    addPad,
    addPads,
    updatePad,
    removePad,
    createBank,
    setPrimaryBank,
    setSecondaryBank,
    setCurrentBank,
    updateBank,
    deleteBank,
    importBank,
    exportBank,
    reorderPads,
    moveBankUp,
    moveBankDown,
    transferPad,
    exportAdminBank,
    canTransferFromBank
  } = useSamplerStore();

  const playbackManager = useGlobalPlaybackManager() as ReturnType<typeof useGlobalPlaybackManager> & {
    triggerToggle: (padId: string) => void;
    triggerHoldStart: (padId: string) => void;
    triggerHoldStop: (padId: string) => void;
    triggerStutter: (padId: string) => void;
    triggerUnmuteToggle: (padId: string) => void;
  };
  const { theme, toggleTheme } = useTheme();
  const { width: windowWidth } = useWindowSize();
  const midi = useWebMidi();
  const { user } = useAuth();

  // Load settings from localStorage
  const [settings, setSettings] = React.useState<AppSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;

    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const mergedMappings = {
          ...DEFAULT_SYSTEM_MAPPINGS,
          ...(parsed.systemMappings || {})
        } as SystemMappings;
        return { ...defaultSettings, ...parsed, systemMappings: mergedMappings };
      }
    } catch (error) {
      console.warn('Failed to load settings:', error);
    }
    return defaultSettings;
  });

  const [globalMuted, setGlobalMuted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showErrorDialog, setShowErrorDialog] = React.useState(false);
  const [VolumeMixer, setVolumeMixer] = React.useState<React.ComponentType<any> | null>(null);
  const [editRequest, setEditRequest] = React.useState<{ padId: string; token: number } | null>(null);
  const [editBankRequest, setEditBankRequest] = React.useState<{ bankId: string; token: number } | null>(null);

  // Dynamically load VolumeMixer only when mixer is open
  React.useEffect(() => {
    if (settings.mixerOpen && !VolumeMixer) {
      import('./VolumeMixer').then((module) => {
        setVolumeMixer(() => module.VolumeMixer);
      }).catch((error) => {
        console.error('Failed to load VolumeMixer:', error);
      });
    }
  }, [settings.mixerOpen, VolumeMixer]);

  // Save settings to localStorage whenever they change
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings]);

  React.useEffect(() => {
    if (midi.enabled && !midi.accessGranted) {
      midi.requestAccess();
    }
  }, [midi.enabled, midi.accessGranted, midi.requestAccess]);

  // Update individual settings
  const updateSetting = React.useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const requestEditPad = React.useCallback((padId: string) => {
    setEditRequest({ padId, token: Date.now() });
  }, []);

  const requestEditBank = React.useCallback((bankId: string) => {
    setEditBankRequest({ bankId, token: Date.now() });
  }, []);

  const handleToggleHideShortcutLabels = React.useCallback((hide: boolean) => {
    updateSetting('hideShortcutLabels', hide);
  }, [updateSetting]);

  const handleToggleMidiEnabled = React.useCallback((enabled: boolean) => {
    midi.setEnabled(enabled);
    if (enabled) {
      if (!midi.accessGranted) {
        midi.requestAccess();
      }
    } else {
      midi.setSelectedInputId(null);
    }
  }, [midi]);

  const isMac = React.useMemo(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent),
    []
  );

  const defaultPadShortcutLayout = React.useMemo(() => ([
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
    'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P',
    'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';',
    'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9', 'Numpad0'
  ]), []);

  const defaultBankShortcutLayout = React.useMemo(() => {
    const modifier = isMac ? 'Meta' : 'Alt';
    return [
      `${modifier}+1`, `${modifier}+2`, `${modifier}+3`, `${modifier}+4`, `${modifier}+5`,
      `${modifier}+6`, `${modifier}+7`, `${modifier}+8`, `${modifier}+9`, `${modifier}+0`
    ];
  }, [isMac]);

  const applyDefaultLayoutToBank = React.useCallback((bankId: string | null) => {
    if (!bankId) return;
    const bank = banks.find((entry) => entry.id === bankId);
    if (!bank) return;
    const sortedPads = [...bank.pads].sort((a, b) => (a.position || 0) - (b.position || 0));
    sortedPads.forEach((pad, index) => {
      const desiredKey = defaultPadShortcutLayout[index] || undefined;
      if (pad.shortcutKey !== desiredKey) {
        updatePad(bank.id, pad.id, { ...pad, shortcutKey: desiredKey });
      }
    });
  }, [banks, defaultPadShortcutLayout, updatePad]);

  const orderedBanks = React.useMemo(() => {
    return [...banks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [banks]);

  const lastAppliedLayoutRef = React.useRef<{ primary?: string | null; secondary?: string | null; single?: string | null }>({});
  React.useEffect(() => {
    if (isDualMode) {
      if (primaryBankId && lastAppliedLayoutRef.current.primary !== primaryBankId) {
        applyDefaultLayoutToBank(primaryBankId);
        lastAppliedLayoutRef.current.primary = primaryBankId;
      }
      if (secondaryBankId && lastAppliedLayoutRef.current.secondary !== secondaryBankId) {
        applyDefaultLayoutToBank(secondaryBankId);
        lastAppliedLayoutRef.current.secondary = secondaryBankId;
      }
    } else if (currentBankId && lastAppliedLayoutRef.current.single !== currentBankId) {
      applyDefaultLayoutToBank(currentBankId);
      lastAppliedLayoutRef.current.single = currentBankId;
    }
  }, [applyDefaultLayoutToBank, currentBankId, isDualMode, primaryBankId, secondaryBankId]);

  const previousPadCountsRef = React.useRef<Map<string, number>>(new Map());
  React.useEffect(() => {
    const previousCounts = previousPadCountsRef.current;
    const nextCounts = new Map<string, number>();
    banks.forEach((bank) => {
      const currentCount = bank.pads.length;
      const previousCount = previousCounts.get(bank.id) ?? 0;
      nextCounts.set(bank.id, currentCount);
      if (previousCount === 0 && currentCount > 0) {
        applyDefaultLayoutToBank(bank.id);
      }
    });
    previousPadCountsRef.current = nextCounts;
  }, [banks, applyDefaultLayoutToBank]);

  const updateSystemMapping = React.useCallback((action: SystemAction, updates: Partial<SystemMappings[SystemAction]>) => {
    setSettings(prev => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        [action]: {
          ...prev.systemMappings[action],
          ...updates
        }
      }
    }));
  }, []);

  const updateSystemKey = React.useCallback((action: SystemAction, key: string) => {
    updateSystemMapping(action, { key });
  }, [updateSystemMapping]);

  const updateSystemMidi = React.useCallback((action: SystemAction, midiNote?: number, midiCC?: number) => {
    updateSystemMapping(action, { midiNote, midiCC });
  }, [updateSystemMapping]);

  const updateSystemColor = React.useCallback((action: SystemAction, color?: string) => {
    updateSystemMapping(action, { color });
  }, [updateSystemMapping]);

  const resetSystemMapping = React.useCallback((action: SystemAction) => {
    setSettings(prev => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        [action]: { ...DEFAULT_SYSTEM_MAPPINGS[action] }
      }
    }));
  }, []);

  const setMasterVolumeCC = React.useCallback((cc?: number) => {
    setSettings(prev => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        masterVolumeCC: cc
      }
    }));
  }, []);

  const updateChannelMapping = React.useCallback(
    (channelIndex: number, updates: Partial<ChannelMappingEntry>) => {
      setSettings(prev => {
        const nextMappings = [...((prev.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [])];
        while (nextMappings.length < 8) {
          nextMappings.push({ keyUp: '', keyDown: '', keyStop: '', midiCC: undefined, midiNote: undefined });
        }
        nextMappings[channelIndex] = { ...nextMappings[channelIndex], ...updates };
        return {
          ...prev,
          systemMappings: {
            ...prev.systemMappings,
            channelMappings: nextMappings
          }
        };
      });
    },
    []
  );

  const systemActions = React.useMemo(
    () =>
      (Object.keys(DEFAULT_SYSTEM_MAPPINGS) as Array<keyof SystemMappings>)
        .filter((key) => key !== 'channelMappings' && key !== 'masterVolumeCC') as SystemAction[],
    []
  );

  const buildEmptyChannelMappings = React.useCallback(
    () => DEFAULT_SYSTEM_MAPPINGS.channelMappings.map((entry) => ({ ...entry })),
    []
  );

  const handleResetAllSystemMappings = React.useCallback(() => {
    setSettings(prev => {
      const nextMappings = { ...prev.systemMappings };
      systemActions.forEach((action) => {
        nextMappings[action] = { ...DEFAULT_SYSTEM_MAPPINGS[action] };
      });
      return { ...prev, systemMappings: nextMappings };
    });
  }, [systemActions]);

  const handleClearAllSystemMappings = React.useCallback(() => {
    setSettings(prev => {
      const nextMappings = { ...prev.systemMappings };
      systemActions.forEach((action) => {
        nextMappings[action] = { key: '' };
      });
      nextMappings.masterVolumeCC = undefined;
      return { ...prev, systemMappings: nextMappings };
    });
  }, [systemActions]);

  const handleResetAllChannelMappings = React.useCallback(() => {
    setSettings(prev => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        channelMappings: buildEmptyChannelMappings()
      }
    }));
  }, [buildEmptyChannelMappings]);

  const handleClearAllChannelMappings = React.useCallback(() => {
    setSettings(prev => ({
      ...prev,
      systemMappings: {
        ...prev.systemMappings,
        channelMappings: buildEmptyChannelMappings()
      }
    }));
  }, [buildEmptyChannelMappings]);

  const buildMappingExport = React.useCallback((): MappingExport => {
    const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];
    const bankShortcutKeys: Record<string, BankMappingValue> = {};
    const padShortcutKeys: Record<string, Record<string, PadMappingValue>> = {};

    banks.forEach((bank) => {
      bankShortcutKeys[bank.id] = {
        shortcutKey: bank.shortcutKey || '',
        midiNote: typeof bank.midiNote === 'number' ? bank.midiNote : null,
        midiCC: typeof bank.midiCC === 'number' ? bank.midiCC : null,
        bankName: bank.name
      };
      const padMappings: Record<string, PadMappingValue> = {};
      bank.pads.forEach((pad) => {
        padMappings[pad.id] = {
          shortcutKey: pad.shortcutKey || '',
          midiNote: typeof pad.midiNote === 'number' ? pad.midiNote : null,
          midiCC: typeof pad.midiCC === 'number' ? pad.midiCC : null,
          padName: pad.name
        };
      });
      padShortcutKeys[bank.id] = padMappings;
    });

    return {
      version: MAPPING_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      systemMappings: settings.systemMappings,
      channelMappings,
      bankShortcutKeys,
      padShortcutKeys
    };
  }, [banks, settings.systemMappings]);

  const handleExportMappings = React.useCallback(async () => {
    const payload = buildMappingExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `vdjv-mappings-${timestamp}.json`;
    return saveMappingFile(blob, fileName);
  }, [buildMappingExport]);

  const handleImportMappings = React.useCallback(
    async (file: File) => {
      const text = await file.text();
      let data: MappingExport | null = null;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw new Error('Invalid mapping file: JSON parse failed.');
      }
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid mapping file: missing data.');
      }

      const incomingSystemMappings = typeof data.systemMappings === 'object' && data.systemMappings ? data.systemMappings : null;
      const incomingChannelMappings = Array.isArray(data.channelMappings)
        ? data.channelMappings
        : (Array.isArray((incomingSystemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] })?.channelMappings)
          ? (incomingSystemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || []
          : (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || []);

      const mergedSystemMappings = {
        ...DEFAULT_SYSTEM_MAPPINGS,
        ...(incomingSystemMappings || {})
      } as SystemMappings;

      (mergedSystemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings = incomingChannelMappings;

      setSettings((prev) => ({
        ...prev,
        systemMappings: mergedSystemMappings
      }));

      const banksById = new Map(banks.map((bank) => [bank.id, bank]));
      const bankShortcutKeys = data.bankShortcutKeys && typeof data.bankShortcutKeys === 'object' ? data.bankShortcutKeys : {};
      const padShortcutKeys = data.padShortcutKeys && typeof data.padShortcutKeys === 'object' ? data.padShortcutKeys : {};
      const hasBankMappings = Object.keys(bankShortcutKeys).length > 0;
      const hasPadMappings = Object.keys(padShortcutKeys).length > 0;
      const bankNameById = new Map<string, string>();
      Object.entries(bankShortcutKeys).forEach(([bankId, mapping]) => {
        const bankMapping = mapping as BankMappingValue;
        if (bankMapping?.bankName) {
          bankNameById.set(bankId, bankMapping.bankName);
        }
      });

      if (hasBankMappings) {
        banks.forEach((bank) => {
          updateBank(bank.id, { shortcutKey: undefined, midiNote: undefined, midiCC: undefined });
        });
      }

      if (hasPadMappings) {
        banks.forEach((bank) => {
          bank.pads.forEach((pad) => {
            updatePad(bank.id, pad.id, {
              ...pad,
              shortcutKey: undefined,
              midiNote: undefined,
              midiCC: undefined
            });
          });
        });
      }

      let appliedBanks = 0;
      let skippedBanks = 0;
      let appliedPads = 0;
      let skippedPads = 0;
      Object.entries(bankShortcutKeys).forEach(([bankId, mapping]) => {
        const bankMapping = mapping as BankMappingValue;
        let bank = banksById.get(bankId);
        if (!bank && bankMapping?.bankName) {
          bank = banks.find((entry) => entry.name === bankMapping.bankName);
        }
        if (!bank) {
          skippedBanks += 1;
          return;
        }
        if (!mapping || typeof mapping !== 'object') return;
        const nextShortcut = typeof bankMapping.shortcutKey === 'string' ? bankMapping.shortcutKey : '';
        updateBank(bank.id, {
          shortcutKey: nextShortcut ? nextShortcut : undefined,
          midiNote: typeof bankMapping.midiNote === 'number' ? bankMapping.midiNote : undefined,
          midiCC: typeof bankMapping.midiCC === 'number' ? bankMapping.midiCC : undefined
        });
        appliedBanks += 1;
      });

      Object.entries(padShortcutKeys).forEach(([bankId, padMappings]) => {
        let bank = banksById.get(bankId);
        if (!bank) {
          const bankName = bankNameById.get(bankId);
          if (bankName) {
            bank = banks.find((entry) => entry.name === bankName);
          }
        }
        if (!bank) {
          if (padMappings && typeof padMappings === 'object') {
            skippedPads += Object.keys(padMappings).length;
          }
          skippedBanks += 1;
          return;
        }
        if (!padMappings || typeof padMappings !== 'object') return;
        Object.entries(padMappings as Record<string, PadMappingValue>).forEach(([padId, mapping]) => {
          let pad = bank.pads.find((entry) => entry.id === padId);
          if (!pad && mapping?.padName) {
            pad = bank.pads.find((entry) => entry.name === mapping.padName);
          }
          if (!pad) {
            skippedPads += 1;
            return;
          }
          const nextShortcut = typeof mapping.shortcutKey === 'string' ? mapping.shortcutKey : '';
          const updatedPad: PadData = {
            ...pad,
            shortcutKey: nextShortcut ? nextShortcut : undefined,
            midiNote: typeof mapping.midiNote === 'number' ? mapping.midiNote : undefined,
            midiCC: typeof mapping.midiCC === 'number' ? mapping.midiCC : undefined
          };
          updatePad(bank.id, pad.id, updatedPad);
          appliedPads += 1;
        });
      });

      return `Mappings imported. Banks: ${appliedBanks} updated, ${skippedBanks} skipped. Pads: ${appliedPads} updated, ${skippedPads} skipped.`;
    },
    [banks, settings.systemMappings, updateBank, updatePad, setSettings]
  );

  const normalizeMidiValue = React.useCallback((value: number) => {
    // Scale full MIDI CC range (0-127) to 0-1.
    const clamped = Math.max(0, Math.min(127, value));
    return clamped / 127;
  }, []);

  // Get playing pads from global manager
  const channelStates = playbackManager.getChannelStates();
  const legacyPlayingPads = playbackManager.getLegacyPlayingPads();

  const getPreferredOutputName = React.useCallback(() => {
    const selectedInput = midi.inputs.find((input) => input.id === midi.selectedInputId);
    return selectedInput?.name;
  }, [midi.inputs, midi.selectedInputId]);

  const lastLedNotesRef = React.useRef<Set<number>>(new Set());
  const ledEchoRef = React.useRef<Map<string, number>>(new Map());
  const systemFlashRef = React.useRef<Map<number, { until: number; color: string; channel: number }>>(new Map());
  const [ledFlashTick, setLedFlashTick] = React.useState(0);

  const markLedEcho = React.useCallback((note: number, channel: number) => {
    ledEchoRef.current.set(`${note}:${channel}`, Date.now());
  }, []);

  const flashSystemLed = React.useCallback(
    (note: number | undefined, color: string, channel: number, durationMs: number = 250) => {
      if (typeof note !== 'number') return;
      systemFlashRef.current.set(note, { until: Date.now() + durationMs, color, channel });
      setLedFlashTick(Date.now());
      window.setTimeout(() => setLedFlashTick(Date.now()), durationMs + 20);
    },
    []
  );

  const [uploadInProgress, setUploadInProgress] = React.useState(false);
  const [importInProgress, setImportInProgress] = React.useState(false);

  React.useEffect(() => {
    const handleUploadStart = () => setUploadInProgress(true);
    const handleUploadEnd = () => setUploadInProgress(false);
    const handleImportStart = () => setImportInProgress(true);
    const handleImportEnd = () => setImportInProgress(false);
    window.addEventListener('vdjv-upload-start', handleUploadStart as EventListener);
    window.addEventListener('vdjv-upload-end', handleUploadEnd as EventListener);
    window.addEventListener('vdjv-import-start', handleImportStart as EventListener);
    window.addEventListener('vdjv-import-end', handleImportEnd as EventListener);
    return () => {
      window.removeEventListener('vdjv-upload-start', handleUploadStart as EventListener);
      window.removeEventListener('vdjv-upload-end', handleUploadEnd as EventListener);
      window.removeEventListener('vdjv-import-start', handleImportStart as EventListener);
      window.removeEventListener('vdjv-import-end', handleImportEnd as EventListener);
    };
  }, []);

  React.useEffect(() => {
    if (!midi.accessGranted) return;
    const outputName = getPreferredOutputName();
    const nextNotes = new Set<number>();
    const allPadNotes = new Set<number>();
    const targetPadNotes = new Set<number>();
    const playingPads = new Set(
      playbackManager.getAllPlayingPads().map((entry) => `${entry.bankId}:${entry.padId}`)
    );

    const solidChannel = 6;
    const midChannel = 0;
    const pulseChannel = 7;
    const blinkChannel = 13;

    const midiProfile = settings.midiDeviceProfileId
      ? getMidiDeviceProfileById(settings.midiDeviceProfileId)
      : getMidiDeviceProfile(outputName);
    const resolveLed = (note: number, desired: string, channel: number) =>
      midiProfile.resolveLed(note, desired, channel);

    const midiShiftActive = midiShiftActiveRef.current;
    const targetPadBankId = isDualMode
      ? (midiShiftActive ? secondaryBankId : primaryBankId)
      : currentBankId;

    banks.forEach((bank) => {
      bank.pads.forEach((pad) => {
        if (typeof pad.midiNote === 'number') {
          allPadNotes.add(pad.midiNote);
        }
      });
      if (typeof bank.midiNote === 'number') {
        const isActiveBank = isDualMode
          ? bank.id === primaryBankId || bank.id === secondaryBankId
          : bank.id === currentBankId;
        const bankChannel = isActiveBank ? pulseChannel : midChannel;
        const led = resolveLed(bank.midiNote, bank.defaultColor, bankChannel);
        midi.sendNoteOn(bank.midiNote, led.velocity, { outputName, channel: led.channel });
        markLedEcho(bank.midiNote, led.channel);
        nextNotes.add(bank.midiNote);
      }
    });

    if (targetPadBankId) {
      const targetBank = banks.find((bank) => bank.id === targetPadBankId);
      if (targetBank) {
        targetBank.pads.forEach((pad) => {
          if (typeof pad.midiNote !== 'number') return;
          targetPadNotes.add(pad.midiNote);
          const padChannel = settings.editMode ? midChannel : solidChannel;
          if (playingPads.has(`${targetBank.id}:${pad.id}`)) {
            const led = resolveLed(pad.midiNote, pad.color, blinkChannel);
            midi.sendNoteOn(pad.midiNote, led.velocity, { outputName, channel: led.channel });
            markLedEcho(pad.midiNote, led.channel);
            nextNotes.add(pad.midiNote);
            return;
          }
          const led = resolveLed(pad.midiNote, pad.color, padChannel);
          midi.sendNoteOn(pad.midiNote, led.velocity, { outputName, channel: led.channel });
          markLedEcho(pad.midiNote, led.channel);
          nextNotes.add(pad.midiNote);
        });
      }
    }

    const systemDefaults: Record<SystemAction, string> = {
      stopAll: '#00ff00',
      mixer: '#00a9ff',
      editMode: '#ffff00',
      mute: '#ff0000',
      banksMenu: '#00a9ff',
      nextBank: '#ffffff',
      prevBank: '#ffffff',
      upload: '#ffffff',
      volumeUp: '#ffffff',
      volumeDown: '#ffffff',
      padSizeUp: '#ffffff',
      padSizeDown: '#ffffff',
      importBank: '#ffffff',
      toggleTheme: '#ffffff',
      activateSecondary: '#7f00ff',
      midiShift: '#00a9ff'
    };

    (Object.keys(settings.systemMappings) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const action = key as SystemAction;
        const mapping = settings.systemMappings[action];
        if (typeof mapping?.midiNote !== 'number') return;
        const flash = systemFlashRef.current.get(mapping.midiNote);
        const now = Date.now();
        if (flash && flash.until > now) {
          const led = resolveLed(mapping.midiNote, flash.color, flash.channel);
          midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
          markLedEcho(mapping.midiNote, led.channel);
          nextNotes.add(mapping.midiNote);
          return;
        }

        const baseColor = mapping.color || systemDefaults[action] || LED_COLOR_OPTIONS[0]?.hex || '#ff0000';
        let channel = midChannel;
        if (action === 'mixer') channel = settings.mixerOpen ? solidChannel : midChannel;
        if (action === 'banksMenu') channel = settings.sideMenuOpen ? solidChannel : midChannel;
        if (action === 'editMode') channel = settings.editMode ? solidChannel : midChannel;
        if (action === 'toggleTheme') channel = theme === 'light' ? solidChannel : midChannel;
        if (action === 'activateSecondary') channel = isDualMode ? solidChannel : midChannel;
        if (action === 'midiShift') {
          const shiftEnabled = isDualMode && Boolean(secondaryBankId);
          channel = shiftEnabled ? (midiShiftActive ? blinkChannel : solidChannel) : midChannel;
        }
        if (action === 'upload' && uploadInProgress) channel = blinkChannel;
        if (action === 'importBank' && importInProgress) channel = blinkChannel;

        const ledColor = action === 'midiShift' && midiShiftActive ? '#ff0000' : baseColor;
        const led = resolveLed(mapping.midiNote, ledColor, channel);
        midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
        markLedEcho(mapping.midiNote, led.channel);
        nextNotes.add(mapping.midiNote);
      });

    const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiNote !== 'number') return;
      const led = resolveLed(mapping.midiNote, '#ff0000', solidChannel);
      midi.sendNoteOn(mapping.midiNote, led.velocity, { outputName, channel: led.channel });
      markLedEcho(mapping.midiNote, led.channel);
      nextNotes.add(mapping.midiNote);
    });

    const allLedChannels = [solidChannel, midChannel, pulseChannel, blinkChannel];

    allPadNotes.forEach((note) => {
      if (targetPadNotes.has(note)) return;
      if (nextNotes.has(note)) return;
      allLedChannels.forEach((channel) => {
        // Use note-on with velocity 0 for devices that ignore note-off.
        midi.sendNoteOn(note, 0, { outputName, channel });
        markLedEcho(note, channel);
      });
    });

    lastLedNotesRef.current.forEach((note) => {
      if (!nextNotes.has(note)) {
        allLedChannels.forEach((channel) => {
          midi.sendNoteOn(note, 0, { outputName, channel });
          markLedEcho(note, channel);
        });
      }
    });
    lastLedNotesRef.current = nextNotes;
  }, [
    banks,
    settings.systemMappings,
    midi,
    getPreferredOutputName,
    playbackManager,
    isDualMode,
    primaryBankId,
    secondaryBankId,
    currentBankId,
    markLedEcho,
    settings.editMode,
    settings.mixerOpen,
    settings.sideMenuOpen,
    theme,
    uploadInProgress,
    importInProgress,
    ledFlashTick,
    settings.midiDeviceProfileId
  ]);

  // Error boundary effect
  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Application Error:', event.error);
      setError(`An error occurred: ${event.error?.message || 'Unknown error'}`);
      setShowErrorDialog(true);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled Promise Rejection:', event.reason);
      setError(`Promise rejection: ${event.reason?.message || 'Unknown error'}`);
      setShowErrorDialog(true);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Handle responsive side menu behavior
  React.useEffect(() => {
    const isMobile = windowWidth < 768;
    if (isMobile && settings.sideMenuOpen && settings.mixerOpen) {
      updateSetting('mixerOpen', false);
    }
  }, [windowWidth, settings.sideMenuOpen, settings.mixerOpen, updateSetting]);

  // Apply global settings to playback manager
  React.useEffect(() => {
    playbackManager.setGlobalMute(globalMuted);
  }, [globalMuted, playbackManager]);

  React.useEffect(() => {
    playbackManager.setMasterVolume(settings.masterVolume);
  }, [settings.masterVolume, playbackManager]);

  React.useEffect(() => {
    playbackManager.applyGlobalEQ(settings.eqSettings);
  }, [settings.eqSettings, playbackManager]);

  const handleSideMenuToggle = React.useCallback((open: boolean) => {
    updateSetting('sideMenuOpen', open);
    if (open && windowWidth < 768) {
      updateSetting('mixerOpen', false);
    }
  }, [windowWidth, updateSetting]);

  const handleMixerToggle = React.useCallback((open: boolean) => {
    updateSetting('mixerOpen', open);
    if (open && windowWidth < 768) {
      updateSetting('sideMenuOpen', false);
    }
  }, [windowWidth, updateSetting]);

  const handleFileUpload = React.useCallback(async (file: File, targetBankId?: string) => {
    try {
      const effectiveUser = user || getCachedUser();
      if (!effectiveUser) {
        window.dispatchEvent(new Event('vdjv-login-request'));
        return;
      }
      if (!file.type.startsWith('audio/')) {
        setError('Invalid file type. Please select an audio file.');
        setShowErrorDialog(true);
        return;
      }

      const maxAudioSizeMB = 50;
      const maxAudioSizeBytes = maxAudioSizeMB * 1024 * 1024;

      if (file.size > maxAudioSizeBytes) {
        setError(`Audio file is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size allowed is ${maxAudioSizeMB}MB. Please use a smaller audio file.`);
        setShowErrorDialog(true);
        return;
      }

      window.dispatchEvent(new Event('vdjv-upload-start'));
      await addPad(file, targetBankId);
      window.dispatchEvent(new Event('vdjv-upload-end'));
    } catch (error) {
      console.error('Error uploading file:', error);
      window.dispatchEvent(new Event('vdjv-upload-end'));
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to upload file. Please try again.');
      }
      setShowErrorDialog(true);
    }
  }, [addPad, user]);

  const handleStopAll = React.useCallback(() => {

    playbackManager.stopAllPads(settings.stopMode);
  }, [playbackManager, settings.stopMode]);

  const handleStopSpecificPad = React.useCallback((padId: string) => {

    playbackManager.stopPad(padId, settings.stopMode);
  }, [playbackManager, settings.stopMode]);

  const handleToggleMute = React.useCallback(() => {
    const newMuted = !globalMuted;

    setGlobalMuted(newMuted);
  }, [globalMuted]);

  const handlePadVolumeChange = React.useCallback((padId: string, volume: number) => {

    for (const bank of banks) {
      const pad = bank.pads.find(p => p.id === padId);
      if (pad) {
        updatePad(bank.id, padId, { ...pad, volume });
        break;
      }
    }
    playbackManager.updatePadVolume(padId, volume);
  }, [banks, updatePad, playbackManager]);

  const handleChannelVolumeChange = React.useCallback((channelId: number, volume: number) => {
    playbackManager.setChannelVolume(channelId, volume);
  }, [playbackManager]);

  const handleStopChannel = React.useCallback((channelId: number) => {
    const channelState = playbackManager.getChannelStates().find((c) => c.channelId === channelId);
    if (channelState?.pad?.padId) {
      playbackManager.stopPad(channelState.pad.padId, settings.stopMode);
    }
  }, [playbackManager, settings.stopMode]);

  const handlePadSizeChange = React.useCallback((size: number) => {
    // In dual mode, ensure pad size is even
    if (isDualMode && size % 2 !== 0) {
      size = size > 1 ? size - 1 : size + 1;
    }
    updateSetting('padSize', size);
  }, [isDualMode, updateSetting]);

  const handleResetPadSize = React.useCallback(() => {
    updateSetting('padSize', 4);
  }, [updateSetting]);

  const maxPadSize = windowWidth < 768 ? 6 : 14;

  const handlePadSizeIncrease = React.useCallback(() => {
    let newSize = settings.padSize + 1;
    if (isDualMode && newSize % 2 !== 0 && newSize < maxPadSize) {
      newSize = newSize + 1;
    }
    if (newSize <= maxPadSize) {
      handlePadSizeChange(newSize);
    }
  }, [settings.padSize, isDualMode, maxPadSize, handlePadSizeChange]);

  const handlePadSizeDecrease = React.useCallback(() => {
    let newSize = settings.padSize - 1;
    if (isDualMode && newSize % 2 !== 0 && newSize > 1) {
      newSize = newSize - 1;
    }
    if (newSize >= 1) {
      handlePadSizeChange(newSize);
    }
  }, [settings.padSize, isDualMode, handlePadSizeChange]);

  // Handle pad removal - ensure playback manager cleans up
  const handleRemovePad = React.useCallback((bankId: string, id: string) => {
    console.log('Removing pad and cleaning up playback:', id);
    // Stop and clean up the pad in the global manager first
    playbackManager.unregisterPad(id);
    // Then remove from the store
    removePad(bankId, id);
  }, [playbackManager, removePad]);

  // Handle bank deletion - clean up all pads
  const handleDeleteBank = React.useCallback((bankId: string) => {
    const bank = banks.find(b => b.id === bankId);
    if (bank) {
      console.log('Cleaning up playback for all pads in bank:', bankId);
      // Clean up all pads in the bank from the playback manager
      bank.pads.forEach(pad => {
        playbackManager.unregisterPad(pad.id);
      });
    }
    deleteBank(bankId);
  }, [banks, playbackManager, deleteBank]);

  // Handle pad updates with error handling
  const handleUpdatePad = React.useCallback(
    async (bankId: string, id: string, updatedPad: any) => {
      try {
        // Look for the pad across all banks, in case bankId is stale
        let targetBank = banks.find(b => b.pads.some(p => p.id === id));
        if (!targetBank) {
          throw new Error('Pad not found');
        }

        const currentPad = targetBank.pads.find(p => p.id === id);
        if (!currentPad) {
          throw new Error('Pad not found');
        }

        // Merge updated fields with existing pad
        const mergedPad = {
          ...currentPad,
          ...updatedPad,
          imageData:
            updatedPad.imageData !== undefined
              ? updatedPad.imageData
              : currentPad.imageData,
          imageUrl:
            updatedPad.imageUrl !== undefined
              ? updatedPad.imageUrl
              : currentPad.imageUrl,
        };

        await updatePad(targetBank.id, id, mergedPad);
      } catch (error) {
        console.error('Failed to update pad:', error);
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError('Failed to update pad. Please try again.');
        }
        setShowErrorDialog(true);
      }
    },
    [banks, updatePad]
  );

  const padShortcutByBank = React.useMemo(() => {
    const map = new Map<string, Map<string, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<string, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const normalized = normalizeStoredShortcutKey(pad.shortcutKey);
        if (normalized) {
          bankMap.set(normalized, { pad: { ...pad, shortcutKey: normalized }, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks, normalizeStoredShortcutKey]);

  const midiNoteByBank = React.useMemo(() => {
    const map = new Map<string, Map<number, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<number, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiNote === 'number') {
          bankMap.set(midiPad.midiNote, { pad: midiPad, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks]);

  const midiCCByBank = React.useMemo(() => {
    const map = new Map<string, Map<number, { pad: PadData; bankId: string; bankName: string }>>();
    banks.forEach((bank) => {
      const bankMap = new Map<number, { pad: PadData; bankId: string; bankName: string }>();
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiCC === 'number') {
          bankMap.set(midiPad.midiCC, { pad: midiPad, bankId: bank.id, bankName: bank.name });
        }
      });
      map.set(bank.id, bankMap);
    });
    return map;
  }, [banks]);

  const midiBankNoteMap = React.useMemo(() => {
    const map = new Map<number, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') {
        map.set(bank.midiNote, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks]);

  const midiBankCCMap = React.useMemo(() => {
    const map = new Map<number, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      if (typeof bank.midiCC === 'number') {
        map.set(bank.midiCC, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks]);

  const midiNoteAssignments = React.useMemo(() => {
    const assignments: Array<{ note: number; type: 'pad' | 'bank'; bankName: string; padName?: string }> = [];
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') {
        assignments.push({ note: bank.midiNote, type: 'bank', bankName: bank.name });
      }
      bank.pads.forEach((pad) => {
        if (typeof pad.midiNote === 'number') {
          assignments.push({
            note: pad.midiNote,
            type: 'pad',
            bankName: bank.name,
            padName: pad.name
          });
        }
      });
    });
    return assignments;
  }, [banks]);

  const bankShortcutMap = React.useMemo(() => {
    const map = new Map<string, { bankId: string; bankName: string }>();
    banks.forEach((bank) => {
      const normalized = normalizeStoredShortcutKey(bank.shortcutKey);
      if (normalized) {
        map.set(normalized, { bankId: bank.id, bankName: bank.name });
      }
    });
    return map;
  }, [banks, normalizeStoredShortcutKey]);

  const padBankShortcutKeys = React.useMemo(() => {
    const keys = new Set<string>();
    banks.forEach((bank) => {
      const bankKey = normalizeStoredShortcutKey(bank.shortcutKey);
      if (bankKey) keys.add(bankKey);
      bank.pads.forEach((pad) => {
        const padKey = normalizeStoredShortcutKey(pad.shortcutKey);
        if (padKey) keys.add(padKey);
      });
    });
    return keys;
  }, [banks, normalizeStoredShortcutKey]);

  const padBankMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    banks.forEach((bank) => {
      if (typeof bank.midiNote === 'number') notes.add(bank.midiNote);
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiNote === 'number') notes.add(midiPad.midiNote);
      });
    });
    return notes;
  }, [banks]);

  const padBankMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    banks.forEach((bank) => {
      if (typeof bank.midiCC === 'number') ccs.add(bank.midiCC);
      bank.pads.forEach((pad) => {
        const midiPad = pad as PadWithMidi;
        if (typeof midiPad.midiCC === 'number') ccs.add(midiPad.midiCC);
      });
    });
    return ccs;
  }, [banks]);

  const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];

  const systemKeys = React.useMemo(() => {
    const keys = new Set<string>();
    (Object.keys(settings.systemMappings) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (mapping?.key) keys.add(mapping.key);
      });
    return keys;
  }, [settings.systemMappings]);

  const systemMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    (Object.keys(settings.systemMappings) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (typeof mapping?.midiNote === 'number') notes.add(mapping.midiNote);
      });
    return notes;
  }, [settings.systemMappings]);

  const systemMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    (Object.keys(settings.systemMappings) as Array<keyof SystemMappings>)
      .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings')
      .forEach((key) => {
        const mapping = settings.systemMappings[key as SystemAction];
        if (typeof mapping?.midiCC === 'number') ccs.add(mapping.midiCC);
      });
    if (typeof settings.systemMappings.masterVolumeCC === 'number') {
      ccs.add(settings.systemMappings.masterVolumeCC);
    }
    return ccs;
  }, [settings.systemMappings]);

  const channelKeys = React.useMemo(() => {
    const keys = new Set<string>();
    channelMappings.forEach((mapping) => {
      if (mapping?.keyUp) keys.add(mapping.keyUp);
      if (mapping?.keyDown) keys.add(mapping.keyDown);
      if (mapping?.keyStop) keys.add(mapping.keyStop);
    });
    return keys;
  }, [channelMappings]);

  const channelMidiNotes = React.useMemo(() => {
    const notes = new Set<number>();
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiNote === 'number') notes.add(mapping.midiNote);
    });
    return notes;
  }, [channelMappings]);

  const channelMidiCCs = React.useMemo(() => {
    const ccs = new Set<number>();
    channelMappings.forEach((mapping) => {
      if (typeof mapping?.midiCC === 'number') ccs.add(mapping.midiCC);
    });
    return ccs;
  }, [channelMappings]);

  const blockedShortcutKeys = React.useMemo(() => new Set([...systemKeys, ...channelKeys]), [systemKeys, channelKeys]);
  const blockedMidiNotes = React.useMemo(() => new Set([...systemMidiNotes, ...channelMidiNotes]), [systemMidiNotes, channelMidiNotes]);
  const blockedMidiCCs = React.useMemo(() => new Set([...systemMidiCCs, ...channelMidiCCs]), [systemMidiCCs, channelMidiCCs]);

  React.useEffect(() => {
    if (orderedBanks.length === 0) return;
    const usedKeys = new Set<string>();
    systemKeys.forEach((key) => usedKeys.add(key));
    channelKeys.forEach((key) => usedKeys.add(key));
    padBankShortcutKeys.forEach((key) => usedKeys.add(key));

    const normalizedCandidates = defaultBankShortcutLayout
      .map((entry) => {
        const [modifier, key] = entry.split('+');
        if (!modifier || !key) return null;
        const lower = modifier.toLowerCase();
        return normalizeShortcutKey(key, {
          altKey: lower === 'alt',
          metaKey: lower === 'meta' || lower === 'cmd' || lower === 'command'
        });
      })
      .filter(Boolean) as string[];

    let candidateIndex = 0;
    orderedBanks.forEach((bank) => {
      const currentKey = normalizeStoredShortcutKey(bank.shortcutKey);
      if (currentKey) return;
      while (candidateIndex < normalizedCandidates.length && usedKeys.has(normalizedCandidates[candidateIndex])) {
        candidateIndex += 1;
      }
      if (candidateIndex >= normalizedCandidates.length) return;
      const nextKey = normalizedCandidates[candidateIndex];
      usedKeys.add(nextKey);
      updateBank(bank.id, { shortcutKey: nextKey });
      candidateIndex += 1;
    });
  }, [orderedBanks, systemKeys, channelKeys, padBankShortcutKeys, defaultBankShortcutLayout, updateBank, normalizeStoredShortcutKey]);

  const ensureRegisteredAndTrigger = React.useCallback(
    (pad: PadData, bankId: string, bankName: string, trigger: () => void) => {
      if (playbackManager.isPadRegistered(pad.id)) {
        trigger();
        return;
      }

      playbackManager
        .registerPad(pad.id, pad, bankId, bankName)
        .then(() => trigger())
        .catch((error) => {
          console.error('Failed to register pad for shortcut:', pad.id, error);
        });
    },
    [playbackManager]
  );

  const activeHoldKeysRef = React.useRef<Map<string, string>>(new Map());
  const lastSelectedBankIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!isDualMode && currentBankId) {
      lastSelectedBankIdRef.current = currentBankId;
      return;
    }
    if (isDualMode && secondaryBankId) {
      lastSelectedBankIdRef.current = secondaryBankId;
    }
  }, [isDualMode, currentBankId, secondaryBankId]);

  const handleBankShortcut = React.useCallback((bankId: string) => {
    if (isDualMode) {
      if (bankId === primaryBankId) {
        const fallback = lastSelectedBankIdRef.current;
        if (fallback && fallback !== primaryBankId) {
          setSecondaryBank(fallback);
        }
        return;
      }
      setSecondaryBank(bankId);
      lastSelectedBankIdRef.current = bankId;
      return;
    }
    setCurrentBank(bankId);
    lastSelectedBankIdRef.current = bankId;
  }, [isDualMode, primaryBankId, setSecondaryBank, setCurrentBank]);

  const handleCycleBank = React.useCallback((direction: 'next' | 'prev') => {
    if (orderedBanks.length === 0) return;
    const activeId = isDualMode ? (secondaryBankId || primaryBankId) : currentBankId;
    const currentIndex = orderedBanks.findIndex((bank) => bank.id === activeId);
    const offset = direction === 'next' ? 1 : -1;
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + offset + orderedBanks.length) % orderedBanks.length;
    const nextId = orderedBanks[nextIndex]?.id;
    if (!nextId) return;
    if (isDualMode) {
      setSecondaryBank(nextId);
    } else {
      setCurrentBank(nextId);
    }
    lastSelectedBankIdRef.current = nextId;
  }, [orderedBanks, isDualMode, secondaryBankId, primaryBankId, currentBankId, setSecondaryBank, setCurrentBank]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target as HTMLElement).tagName) return false;
      const element = target as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        element.isContentEditable
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const normalized = normalizeShortcutKey(event.key, {
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        code: event.code
      });
      if (!normalized) return;

      const systemAction = (Object.keys(settings.systemMappings) as Array<keyof SystemMappings>)
        .filter((key) => key !== 'masterVolumeCC' && key !== 'channelMappings' && key !== 'midiShift')
        .find((key) => settings.systemMappings[key as SystemAction]?.key === normalized) as ExtendedSystemAction | undefined;

      if (systemAction) {
        event.preventDefault();
        switch (systemAction) {
          case 'stopAll':
            handleStopAll();
            flashSystemLed(settings.systemMappings.stopAll?.midiNote, '#00ff00', 6);
            return;
          case 'mixer':
            handleMixerToggle(!settings.mixerOpen);
            return;
          case 'editMode':
            updateSetting('editMode', !settings.editMode);
            return;
          case 'mute':
            handleToggleMute();
            return;
          case 'banksMenu':
            handleSideMenuToggle(!settings.sideMenuOpen);
            return;
          case 'nextBank':
            handleCycleBank('next');
            flashSystemLed(settings.systemMappings.nextBank?.midiNote, '#ffffff', 6);
            return;
          case 'prevBank':
            handleCycleBank('prev');
            flashSystemLed(settings.systemMappings.prevBank?.midiNote, '#ffffff', 6);
            return;
          case 'upload': {
            const input = document.getElementById('global-audio-upload-input') as HTMLInputElement | null;
            input?.click();
            flashSystemLed(settings.systemMappings.upload?.midiNote, '#ffffff', 6);
            return;
          }
          case 'volumeDown': {
            const next = Math.max(0, Number((settings.masterVolume - 0.05).toFixed(2)));
            updateSetting('masterVolume', next);
            return;
          }
          case 'volumeUp': {
            const next = Math.min(1, Number((settings.masterVolume + 0.05).toFixed(2)));
            updateSetting('masterVolume', next);
            return;
          }
          case 'padSizeUp':
            handlePadSizeIncrease();
            flashSystemLed(settings.systemMappings.padSizeUp?.midiNote, '#ffffff', 6);
            return;
          case 'padSizeDown':
            handlePadSizeDecrease();
            flashSystemLed(settings.systemMappings.padSizeDown?.midiNote, '#ffffff', 6);
            return;
          case 'importBank':
            window.dispatchEvent(new Event('vdjv-import-bank'));
            flashSystemLed(settings.systemMappings.importBank?.midiNote, '#ffffff', 6);
            return;
          case 'toggleTheme':
            toggleTheme();
            return;
          case 'activateSecondary': {
            const targetBankId = currentBankId || banks[0]?.id || null;
            if (isDualMode) {
              setPrimaryBank(null);
            } else if (targetBankId) {
              setPrimaryBank(targetBankId);
            }
            return;
          }
        }
      }

      const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];
      for (let i = 0; i < channelMappings.length; i += 1) {
        const mapping = channelMappings[i];
        if (!mapping) continue;
        if (mapping.keyUp && mapping.keyUp === normalized) {
          event.preventDefault();
          const current = playbackManager.getChannelVolume(i + 1);
          const next = Math.min(1, Number((current + 0.05).toFixed(2)));
          playbackManager.setChannelVolume(i + 1, next);
          return;
        }
        if (mapping.keyDown && mapping.keyDown === normalized) {
          event.preventDefault();
          const current = playbackManager.getChannelVolume(i + 1);
          const next = Math.max(0, Number((current - 0.05).toFixed(2)));
          playbackManager.setChannelVolume(i + 1, next);
          return;
        }
        if (mapping.keyStop && mapping.keyStop === normalized) {
          event.preventDefault();
          const channelState = playbackManager.getChannelStates().find((c) => c.channelId === i + 1);
          if (channelState?.pad?.padId) {
            playbackManager.stopPad(channelState.pad.padId, settings.stopMode);
          }
          return;
        }
      }

      if (event.repeat) return;

      const hasNonShiftModifier = event.ctrlKey || event.altKey || event.metaKey;
      const comboKey = hasNonShiftModifier
        ? normalizeShortcutKey(event.key, {
          shiftKey: false,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          code: event.code
        })
        : null;
      const baseKey = normalizeShortcutKey(event.key, { code: event.code });
      if (!baseKey && !comboKey) return;

      const isShifted = !hasNonShiftModifier && event.shiftKey;
      const lookupKey = comboKey && !event.shiftKey ? comboKey : baseKey;

      if (!isShifted && lookupKey) {
        const bankShortcut = bankShortcutMap.get(lookupKey);
        if (bankShortcut) {
          event.preventDefault();
          if (settings.editMode) {
            requestEditBank(bankShortcut.bankId);
            return;
          }
          handleBankShortcut(bankShortcut.bankId);
          return;
        }
      }

      if (!lookupKey) return;
      const targetBankId = isDualMode ? (isShifted ? secondaryBankId : primaryBankId) : currentBankId;
      if (!targetBankId) return;
      const padMap = padShortcutByBank.get(targetBankId);
      const mapped = padMap?.get(lookupKey);
      if (mapped) {
        event.preventDefault();
        if (settings.editMode) {
          requestEditPad(mapped.pad.id);
          return;
        }
        switch (mapped.pad.triggerMode) {
          case 'toggle':
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerToggle(mapped.pad.id)
            );
            break;
          case 'hold': {
            const holdKey = `${mapped.bankId}:${lookupKey}`;
            activeHoldKeysRef.current.set(holdKey, mapped.pad.id);
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerHoldStart(mapped.pad.id)
            );
            break;
          }
          case 'stutter':
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerStutter(mapped.pad.id)
            );
            break;
          case 'unmute':
          default:
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerUnmuteToggle(mapped.pad.id)
            );
            break;
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;

      const hasNonShiftModifier = event.ctrlKey || event.altKey || event.metaKey;
      const comboKey = hasNonShiftModifier
        ? normalizeShortcutKey(event.key, {
          shiftKey: false,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          code: event.code
        })
        : null;
      const baseKey = normalizeShortcutKey(event.key, { code: event.code });
      const lookupKey = comboKey && !event.shiftKey ? comboKey : baseKey;
      if (!lookupKey) return;

      const holdTargets = [
        primaryBankId ? `${primaryBankId}:${lookupKey}` : null,
        secondaryBankId ? `${secondaryBankId}:${lookupKey}` : null,
        currentBankId ? `${currentBankId}:${lookupKey}` : null
      ].filter(Boolean) as string[];
      holdTargets.forEach((holdKey) => {
        const holdPadId = activeHoldKeysRef.current.get(holdKey);
        if (holdPadId) {
          playbackManager.triggerHoldStop(holdPadId);
          activeHoldKeysRef.current.delete(holdKey);
        }
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    handleMixerToggle,
    handleSideMenuToggle,
    handleStopAll,
    handleToggleMute,
    ensureRegisteredAndTrigger,
    padShortcutByBank,
    bankShortcutMap,
    settings.editMode,
    settings.masterVolume,
    settings.mixerOpen,
    settings.sideMenuOpen,
    settings.systemMappings,
    updateSetting,
    isDualMode,
    setCurrentBank,
    setSecondaryBank,
    playbackManager,
    handlePadSizeIncrease,
    handlePadSizeDecrease,
    handleCycleBank,
    toggleTheme,
    currentBankId,
    banks,
    handleBankShortcut,
    primaryBankId,
    secondaryBankId,
    requestEditPad,
    requestEditBank
  ]);

  const midiDebounceRef = React.useRef<Map<string, number>>(new Map());
  const activeMidiNotesRef = React.useRef<Map<string, boolean>>(new Map());
  const midiHoldPadByNoteRef = React.useRef<Map<number, string>>(new Map());
  const midiShiftActiveRef = React.useRef(false);

  React.useEffect(() => {
    if (!isDualMode || !secondaryBankId) {
      midiShiftActiveRef.current = false;
    }
  }, [isDualMode, secondaryBankId]);

  React.useEffect(() => {
    const message = midi.lastMessage;
    if (!message) return;

    const resolvePad = (mapped: { pad: PadData; bankId: string; bankName: string } | undefined) => {
      if (!mapped) return null;
      return mapped;
    };

    const handleSystemAction = (action: ExtendedSystemAction) => {
      switch (action) {
        case 'stopAll':
          handleStopAll();
          flashSystemLed(settings.systemMappings.stopAll?.midiNote, '#00ff00', 6);
          return true;
        case 'mixer':
          handleMixerToggle(!settings.mixerOpen);
          return true;
        case 'editMode':
          updateSetting('editMode', !settings.editMode);
          return true;
        case 'mute':
          handleToggleMute();
          return true;
        case 'banksMenu':
          handleSideMenuToggle(!settings.sideMenuOpen);
          return true;
        case 'nextBank':
          handleCycleBank('next');
          flashSystemLed(settings.systemMappings.nextBank?.midiNote, '#ffffff', 6);
          return true;
        case 'prevBank':
          handleCycleBank('prev');
          flashSystemLed(settings.systemMappings.prevBank?.midiNote, '#ffffff', 6);
          return true;
        case 'upload': {
          const input = document.getElementById('global-audio-upload-input') as HTMLInputElement | null;
          input?.click();
          flashSystemLed(settings.systemMappings.upload?.midiNote, '#ffffff', 6);
          return true;
        }
        case 'volumeUp': {
          const next = Math.min(1, Number((settings.masterVolume + 0.05).toFixed(2)));
          updateSetting('masterVolume', next);
          return true;
        }
        case 'volumeDown': {
          const next = Math.max(0, Number((settings.masterVolume - 0.05).toFixed(2)));
          updateSetting('masterVolume', next);
          return true;
        }
        case 'padSizeUp':
          handlePadSizeIncrease();
          flashSystemLed(settings.systemMappings.padSizeUp?.midiNote, '#ffffff', 6);
          return true;
        case 'padSizeDown':
          handlePadSizeDecrease();
          flashSystemLed(settings.systemMappings.padSizeDown?.midiNote, '#ffffff', 6);
          return true;
        case 'importBank':
          window.dispatchEvent(new Event('vdjv-import-bank'));
          flashSystemLed(settings.systemMappings.importBank?.midiNote, '#ffffff', 6);
          return true;
        case 'toggleTheme':
          toggleTheme();
          return true;
        case 'activateSecondary': {
          const targetBankId = currentBankId || banks[0]?.id || null;
          if (isDualMode) {
            setPrimaryBank(null);
          } else if (targetBankId) {
            setPrimaryBank(targetBankId);
          }
          return true;
        }
      }
      return false;
    };

    const midiShiftNote = settings.systemMappings.midiShift?.midiNote;
    if (message.type === 'noteon' || message.type === 'noteoff') {
      if (message.channel !== 0) {
        const echoAt = ledEchoRef.current.get(`${message.note}:${message.channel}`);
        if (echoAt && Date.now() - echoAt < 80) {
          return;
        }
      }
      const noteKey = `${message.inputId}:${message.note}`;
      if (message.type === 'noteoff') {
        activeMidiNotesRef.current.delete(noteKey);
      } else {
        if (activeMidiNotesRef.current.get(noteKey)) {
          return;
        }
        activeMidiNotesRef.current.set(noteKey, true);
      }

      if (message.note === midiShiftNote) {
        if (isDualMode && secondaryBankId && message.type === 'noteon') {
          midiShiftActiveRef.current = !midiShiftActiveRef.current;
        }
        return;
      }

      if (message.type === 'noteon') {
      const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];
      const channelStopIndex = channelMappings.findIndex((mapping) => mapping?.midiNote === message.note);
      if (channelStopIndex >= 0) {
        handleStopChannel(channelStopIndex + 1);
        return;
      }

        const systemAction = (Object.keys(settings.systemMappings) as ExtendedSystemAction[]).find(
          (action) => action !== 'midiShift' && settings.systemMappings[action]?.midiNote === message.note
        );
        if (systemAction && handleSystemAction(systemAction)) {
          return;
        }
      }

      const midiShiftActive = midiShiftActiveRef.current;
      const targetBankId = isDualMode ? (midiShiftActive ? secondaryBankId : primaryBankId) : currentBankId;
      const secondaryTargetId = isDualMode ? (midiShiftActive ? primaryBankId : secondaryBankId) : null;

      const bankMapping = midiBankNoteMap.get(message.note);
      if (bankMapping && message.type === 'noteon') {
        if (settings.editMode) {
          requestEditBank(bankMapping.bankId);
        } else {
          handleBankShortcut(bankMapping.bankId);
        }
        return;
      }

      const mapped =
        (targetBankId ? resolvePad(midiNoteByBank.get(targetBankId)?.get(message.note)) : null) ||
        (message.type === 'noteoff' && secondaryTargetId ? resolvePad(midiNoteByBank.get(secondaryTargetId)?.get(message.note)) : null);
      if (!mapped) return;

      if (message.type === 'noteoff') {
        if (settings.editMode) {
          return;
        }
        if (mapped.pad.triggerMode === 'hold') {
          const activeHoldPadId = midiHoldPadByNoteRef.current.get(message.note);
          if (activeHoldPadId === mapped.pad.id) {
            ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
              playbackManager.triggerHoldStop(mapped.pad.id)
            );
            midiHoldPadByNoteRef.current.delete(message.note);
          }
        }
        return;
      }

      const debounceKey = `${mapped.pad.id}-${message.note}`;
      const now = Date.now();
      const last = midiDebounceRef.current.get(debounceKey) || 0;
      if (now - last < 120) return;
      midiDebounceRef.current.set(debounceKey, now);

      if (settings.editMode) {
        requestEditPad(mapped.pad.id);
        return;
      }

      switch (mapped.pad.triggerMode) {
        case 'toggle':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerToggle(mapped.pad.id)
          );
          break;
        case 'hold':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerHoldStart(mapped.pad.id)
          );
          midiHoldPadByNoteRef.current.set(message.note, mapped.pad.id);
          break;
        case 'stutter':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerStutter(mapped.pad.id)
          );
          break;
        case 'unmute':
        default:
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerUnmuteToggle(mapped.pad.id)
          );
          break;
      }
    } else if (message.type === 'cc') {
      const channelMappings = (settings.systemMappings as SystemMappings & { channelMappings?: ChannelMappingEntry[] }).channelMappings || [];
      const channelIndex = channelMappings.findIndex((mapping) => mapping?.midiCC === message.cc);
      if (channelIndex >= 0) {
        const next = normalizeMidiValue(message.value);
        playbackManager.setChannelVolume(channelIndex + 1, Number(next.toFixed(3)));
        return;
      }

      if (typeof settings.systemMappings.masterVolumeCC === 'number' && settings.systemMappings.masterVolumeCC === message.cc) {
        const next = normalizeMidiValue(message.value);
        updateSetting('masterVolume', Number(next.toFixed(3)));
        return;
      }

      const systemAction = (Object.keys(settings.systemMappings) as ExtendedSystemAction[]).find(
        (action) => action !== 'midiShift' && settings.systemMappings[action]?.midiCC === message.cc
      );
      if (systemAction && handleSystemAction(systemAction)) {
        return;
      }

      const midiShiftActive = midiShiftActiveRef.current;
      const targetBankId = isDualMode ? (midiShiftActive ? secondaryBankId : primaryBankId) : currentBankId;
      const secondaryTargetId = isDualMode ? (midiShiftActive ? primaryBankId : secondaryBankId) : null;

      const bankMapping = midiBankCCMap.get(message.cc);
      if (bankMapping) {
        if (settings.editMode) {
          requestEditBank(bankMapping.bankId);
        } else {
          handleBankShortcut(bankMapping.bankId);
        }
        return;
      }

      const mapped =
        (targetBankId ? resolvePad(midiCCByBank.get(targetBankId)?.get(message.cc)) : null) ||
        (secondaryTargetId ? resolvePad(midiCCByBank.get(secondaryTargetId)?.get(message.cc)) : null);
      if (!mapped) return;

      const debounceKey = `${mapped.pad.id}-cc-${message.cc}`;
      const now = Date.now();
      const last = midiDebounceRef.current.get(debounceKey) || 0;
      if (now - last < 120) return;
      midiDebounceRef.current.set(debounceKey, now);

      if (settings.editMode) {
        requestEditPad(mapped.pad.id);
        return;
      }

      switch (mapped.pad.triggerMode) {
        case 'toggle':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerToggle(mapped.pad.id)
          );
          break;
        case 'hold':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerHoldStart(mapped.pad.id)
          );
          break;
        case 'stutter':
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerStutter(mapped.pad.id)
          );
          break;
        case 'unmute':
        default:
          ensureRegisteredAndTrigger(mapped.pad, mapped.bankId, mapped.bankName, () =>
            playbackManager.triggerUnmuteToggle(mapped.pad.id)
          );
          break;
      }
    }
  }, [
    midi.lastMessage,
    midiNoteByBank,
    midiCCByBank,
    midiBankNoteMap,
    midiBankCCMap,
    playbackManager,
    ensureRegisteredAndTrigger,
    setCurrentBank,
    setSecondaryBank,
    settings.systemMappings,
    settings.masterVolume,
    settings.mixerOpen,
    settings.sideMenuOpen,
    updateSetting,
    handleStopAll,
    handleMixerToggle,
    handleToggleMute,
    handleSideMenuToggle,
    handlePadSizeIncrease,
    handlePadSizeDecrease,
    handleCycleBank,
    toggleTheme,
    currentBankId,
    primaryBankId,
    secondaryBankId,
    isDualMode,
    banks,
    isDualMode,
    handleBankShortcut,
    primaryBankId,
    secondaryBankId,
    normalizeMidiValue,
    handleStopChannel,
    requestEditPad,
    requestEditBank
  ]);

  // Enhanced pad transfer handler with better dual mode support
  const handleTransferPad = React.useCallback((padId: string, sourceBankId: string, targetBankId: string) => {
    console.log('App handling pad transfer:', { padId, sourceBankId, targetBankId });
    console.log('Current dual mode state:', { isDualMode, primaryBankId, secondaryBankId, currentBankId });

    // Don't transfer to the same bank
    if (sourceBankId === targetBankId) {
      console.log('Source and target banks are the same, ignoring transfer');
      return;
    }

    const sourceBank = banks.find(b => b.id === sourceBankId);
    const targetBank = banks.find(b => b.id === targetBankId);

    if (!sourceBank || !targetBank) {
      console.error('Source or target bank not found:', { sourceBank: !!sourceBank, targetBank: !!targetBank });
      return;
    }

    const padToTransfer = sourceBank.pads.find(p => p.id === padId);
    if (!padToTransfer) {
      console.error('Pad to transfer not found in source bank');
      return;
    }

    // Additional validation for dual mode transfers
    if (isDualMode) {
      const isPrimaryToSecondary = sourceBankId === primaryBankId && targetBankId === secondaryBankId;
      const isSecondaryToPrimary = sourceBankId === secondaryBankId && targetBankId === primaryBankId;

      if (isPrimaryToSecondary) {
        console.log('Transferring from Primary to Secondary bank');
      } else if (isSecondaryToPrimary) {
        console.log('Transferring from Secondary to Primary bank');
      } else {
        console.log('Transferring between active dual mode bank and other bank');
      }
    }

    try {
      console.log('Executing transfer via store...');
      // Use the store's transfer function
      transferPad(padId, sourceBankId, targetBankId);
      console.log('Transfer completed successfully');
    } catch (error) {
      console.error('Failed to transfer pad:', error);
      setError('Failed to transfer pad. Please try again.');
      setShowErrorDialog(true);
    }
  }, [banks, transferPad, isDualMode, primaryBankId, secondaryBankId, currentBankId]);

  // Enhanced drag start handler with better logging
  const handlePadDragStart = React.useCallback((e: React.DragEvent, pad: PadData, sourceBankId: string) => {
    if (!settings.editMode) {
      e.preventDefault();
      return;
    }

    console.log('App level pad drag start:', { padId: pad.id, sourceBankId, isDualMode, primaryBankId, secondaryBankId });

    // Set drag data with comprehensive information
    const transferData = {
      type: 'pad-transfer',
      pad: pad,
      sourceBankId: sourceBankId,
      isDualMode: isDualMode,
      primaryBankId: primaryBankId,
      secondaryBankId: secondaryBankId
    };

    e.dataTransfer.setData('application/json', JSON.stringify(transferData));
    e.dataTransfer.setData('text/plain', JSON.stringify(transferData)); // Fallback
    e.dataTransfer.effectAllowed = 'move';

    console.log('Drag data set:', transferData);
  }, [settings.editMode, isDualMode, primaryBankId, secondaryBankId]);

  const getGridColumns = React.useMemo(() => {
    const isMobile = windowWidth < 768;
    const maxCols = isMobile ? 6 : 14;
    const minCols = isMobile ? 1 : 2;

    let responsiveSize = settings.padSize;

    // Remove the aggressive mobile size limiting - only limit to maxCols
    if (windowWidth < 480) {
      // Very small screens - still allow up to 6 columns but may be harder to use
      responsiveSize = Math.min(settings.padSize, 6);
    }

    const finalSize = Math.max(minCols, Math.min(maxCols, responsiveSize));

    // In dual mode, split the size between two banks
    return isDualMode ? Math.max(1, Math.floor(finalSize / 2)) : finalSize;
  }, [settings.padSize, windowWidth, isDualMode]);

  const getMainContentMargin = React.useMemo(() => {
    const isMobile = windowWidth < 768;

    if (settings.sideMenuOpen && !settings.mixerOpen) {
      return isMobile ? 'ml-0' : 'ml-64';
    } else if (!settings.sideMenuOpen && settings.mixerOpen) {
      return isMobile ? 'mr-0' : 'mr-64';
    } else if (settings.sideMenuOpen && settings.mixerOpen) {
      return isMobile ? 'mx-0' : 'mx-64';
    } else {
      return 'mx-0';
    }
  }, [settings.sideMenuOpen, settings.mixerOpen, windowWidth]);

  const getMainContentPadding = React.useMemo(() => {
    const isMobile = windowWidth < 768;
    return isMobile ? (settings.sideMenuOpen || settings.mixerOpen ? 'px-0' : 'px-1') : 'px-2';
  }, [settings.sideMenuOpen, settings.mixerOpen, windowWidth]);

  const handleErrorClose = () => {
    setShowErrorDialog(false);
    setError(null);
  };

  // Get all pads from all banks for cross-bank controls
  const allPads = React.useMemo(() => {
    return banks.flatMap(bank => bank.pads);
  }, [banks]);

  // Create available banks list for pad transfer
  const availableBanks = React.useMemo(() => {
    return banks.map(bank => ({ id: bank.id, name: bank.name }));
  }, [banks]);

  // Get the banks to display based on current mode
  const getDisplayBanks = () => {
    if (isDualMode) {
      return {
        primaryBank,
        secondaryBank
      };
    } else {
      return {
        singleBank: currentBank
      };
    }
  };

  const { primaryBank: displayPrimary, secondaryBank: displaySecondary, singleBank } = getDisplayBanks();

  const layoutSizeClass = isDualMode ? 'h-screen overflow-hidden' : 'min-h-screen';

  return (
    <div className={`${layoutSizeClass} transition-all duration-300 ${theme === 'dark'
      ? 'bg-gray-900'
      : 'bg-gray-50'
      } flex`}>

      <SideMenu
        open={settings.sideMenuOpen}
        onOpenChange={handleSideMenuToggle}
        banks={banks}
        primaryBankId={primaryBankId}
        secondaryBankId={secondaryBankId}
        currentBankId={currentBankId}
        isDualMode={isDualMode}
        padSize={settings.padSize}
        stopMode={settings.stopMode}
        theme={theme}
        windowWidth={windowWidth}
        editMode={settings.editMode}
        onCreateBank={createBank}
        onSetPrimaryBank={setPrimaryBank}
        onSetSecondaryBank={setSecondaryBank}
        onSetCurrentBank={setCurrentBank}
        onUpdateBank={updateBank}
        onUpdatePad={handleUpdatePad}
        onDeleteBank={handleDeleteBank}
        onImportBank={importBank}
        onExportBank={exportBank}
        onPadSizeChange={handlePadSizeChange}
        onResetPadSize={handleResetPadSize}
        onStopModeChange={(mode) => updateSetting('stopMode', mode)}
        onToggleTheme={toggleTheme}
        onMoveBankUp={moveBankUp}
        onMoveBankDown={moveBankDown}
        onTransferPad={handleTransferPad}
        canTransferFromBank={canTransferFromBank}
        onExportAdmin={exportAdminBank}
        midiEnabled={midi.accessGranted}
        blockedShortcutKeys={blockedShortcutKeys}
        blockedMidiNotes={blockedMidiNotes}
        blockedMidiCCs={blockedMidiCCs}
        editBankRequest={editBankRequest}
        hideShortcutLabels={settings.hideShortcutLabels}
      />

      {VolumeMixer && (
        <VolumeMixer
          open={settings.mixerOpen}
          onOpenChange={handleMixerToggle}
          channelStates={channelStates}
          legacyPlayingPads={legacyPlayingPads}
          masterVolume={settings.masterVolume}
          onMasterVolumeChange={(volume) => updateSetting('masterVolume', volume)}
          onPadVolumeChange={handlePadVolumeChange}
          onStopPad={handleStopSpecificPad}
          onChannelVolumeChange={handleChannelVolumeChange}
          onStopChannel={handleStopChannel}
          eqSettings={settings.eqSettings}
          onEqChange={(eq) => updateSetting('eqSettings', eq)}
          theme={theme}
          windowWidth={windowWidth}
        />
      )}

      <div className={`flex-1 min-h-0 transition-all duration-300 ${getMainContentMargin} ${getMainContentPadding}`}>
        <div className="max-w-full mx-auto py-2 relative z-10 h-full min-h-0 flex flex-col">
          <HeaderControls
            primaryBank={displayPrimary}
            secondaryBank={displaySecondary}
            currentBank={singleBank}
            isDualMode={isDualMode}
            editMode={settings.editMode}
            globalMuted={globalMuted}
            sideMenuOpen={settings.sideMenuOpen}
            mixerOpen={settings.mixerOpen}
            theme={theme}
            windowWidth={windowWidth}
            onFileUpload={handleFileUpload}
            onToggleEditMode={() => updateSetting('editMode', !settings.editMode)}
            onToggleMute={handleToggleMute}
            onStopAll={handleStopAll}
            onToggleSideMenu={() => handleSideMenuToggle(!settings.sideMenuOpen)}
            onToggleMixer={() => handleMixerToggle(!settings.mixerOpen)}
            onToggleTheme={toggleTheme}
            onExitDualMode={() => setPrimaryBank(null)}
            midiSupported={midi.supported}
            midiEnabled={midi.enabled}
            midiAccessGranted={midi.enabled && midi.accessGranted}
            midiBackend={midi.backend}
            midiOutputSupported={midi.outputSupported}
            midiInputs={midi.inputs}
            midiSelectedInputId={midi.selectedInputId}
            midiError={midi.error}
            onRequestMidiAccess={midi.requestAccess}
            onSelectMidiInput={midi.setSelectedInputId}
            onToggleMidiEnabled={handleToggleMidiEnabled}
            systemMappings={settings.systemMappings}
            onUpdateSystemKey={updateSystemKey}
            onResetSystemKey={resetSystemMapping}
            onUpdateSystemMidi={updateSystemMidi}
            onUpdateSystemColor={updateSystemColor}
            onSetMasterVolumeCC={setMasterVolumeCC}
            onUpdateChannelMapping={updateChannelMapping}
            padBankShortcutKeys={padBankShortcutKeys}
            padBankMidiNotes={padBankMidiNotes}
            padBankMidiCCs={padBankMidiCCs}
            midiNoteAssignments={midiNoteAssignments}
            hideShortcutLabels={settings.hideShortcutLabels}
            onToggleHideShortcutLabels={handleToggleHideShortcutLabels}
            onResetAllSystemMappings={handleResetAllSystemMappings}
            onClearAllSystemMappings={handleClearAllSystemMappings}
            onResetAllChannelMappings={handleResetAllChannelMappings}
            onClearAllChannelMappings={handleClearAllChannelMappings}
            onExportMappings={handleExportMappings}
            onImportMappings={handleImportMappings}
            midiDeviceProfiles={midiDeviceProfiles}
            midiDeviceProfileId={settings.midiDeviceProfileId}
            onSelectMidiDeviceProfile={(id) => updateSetting('midiDeviceProfileId', id)}
          />

          {isDualMode ? (
            <div className="flex gap-2 flex-1 min-h-0">
              {/* Primary Bank */}
              <div className="flex-1 min-h-0">
                <div className="h-full overflow-y-auto overscroll-contain pr-1">
                  <PadGrid
                    pads={displayPrimary?.pads || []}
                    bankId={primaryBankId || ''}
                    bankName={displayPrimary?.name || ''}
                    allBanks={banks}
                    allPads={allPads}
                    editMode={settings.editMode}
                    globalMuted={globalMuted}
                    masterVolume={settings.masterVolume}
                    padSize={getGridColumns}
                    theme={theme}
                    stopMode={settings.stopMode}
                    eqSettings={settings.eqSettings}
                    windowWidth={windowWidth}
                    onUpdatePad={handleUpdatePad}
                    onRemovePad={(id) => handleRemovePad(primaryBankId || '', id)}
                    onReorderPads={(fromIndex, toIndex) => reorderPads(primaryBankId || '', fromIndex, toIndex)}
                    onFileUpload={(file) => handleFileUpload(file, primaryBankId || undefined)}
                    onPadDragStart={handlePadDragStart}
                    onTransferPad={handleTransferPad}
                    availableBanks={availableBanks}
                    canTransferFromBank={canTransferFromBank}
                    midiEnabled={midi.enabled && midi.accessGranted}
                    hideShortcutLabel={settings.hideShortcutLabels}
                    editRequest={editRequest}
                    blockedShortcutKeys={blockedShortcutKeys}
                    blockedMidiNotes={blockedMidiNotes}
                    blockedMidiCCs={blockedMidiCCs}
                  />
                </div>
              </div>

              {/* Secondary Bank */}
              <div className="flex-1 min-h-0">
                {displaySecondary ? (
                  <div className="h-full overflow-y-auto overscroll-contain pl-1">
                    <PadGrid
                      pads={displaySecondary.pads || []}
                      bankId={secondaryBankId || ''}
                      bankName={displaySecondary.name || ''}
                      allBanks={banks}
                      allPads={allPads}
                      editMode={settings.editMode}
                      globalMuted={globalMuted}
                      masterVolume={settings.masterVolume}
                      padSize={getGridColumns}
                      theme={theme}
                      stopMode={settings.stopMode}
                      eqSettings={settings.eqSettings}
                      windowWidth={windowWidth}
                      onUpdatePad={handleUpdatePad}
                      onRemovePad={(id) => handleRemovePad(secondaryBankId || '', id)}
                      onReorderPads={(fromIndex, toIndex) => reorderPads(secondaryBankId || '', fromIndex, toIndex)}
                      onFileUpload={(file) => handleFileUpload(file, secondaryBankId || undefined)}
                      onPadDragStart={handlePadDragStart}
                      onTransferPad={handleTransferPad}
                      availableBanks={availableBanks}
                      canTransferFromBank={canTransferFromBank}
                      midiEnabled={midi.enabled && midi.accessGranted}
                      hideShortcutLabel={settings.hideShortcutLabels}
                      editRequest={editRequest}
                      blockedShortcutKeys={blockedShortcutKeys}
                      blockedMidiNotes={blockedMidiNotes}
                      blockedMidiCCs={blockedMidiCCs}
                    />
                  </div>
                ) : (
                  <div className={`flex items-center justify-center h-64 rounded-2xl border-2 border-dashed transition-all duration-300 ${theme === 'dark'
                    ? 'bg-gray-800 border-gray-600'
                    : 'bg-white border-gray-300'
                    }`}>
                    <p className={`text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                      Select a secondary bank from the sidebar
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Single bank mode
            singleBank ? (
              <PadGrid
                pads={singleBank.pads || []}
                bankId={currentBankId || ''}
                bankName={singleBank.name || ''}
                allBanks={banks}
                allPads={allPads}
                editMode={settings.editMode}
                globalMuted={globalMuted}
                masterVolume={settings.masterVolume}
                padSize={getGridColumns}
                theme={theme}
                stopMode={settings.stopMode}
                eqSettings={settings.eqSettings}
                windowWidth={windowWidth}
                onUpdatePad={handleUpdatePad}
                onRemovePad={(id) => handleRemovePad(currentBankId || '', id)}
                onReorderPads={(fromIndex, toIndex) => reorderPads(currentBankId || '', fromIndex, toIndex)}
                onFileUpload={handleFileUpload}
                onPadDragStart={handlePadDragStart}
                onTransferPad={handleTransferPad}
                availableBanks={availableBanks}
                canTransferFromBank={canTransferFromBank}
                midiEnabled={midi.enabled && midi.accessGranted}
                hideShortcutLabel={settings.hideShortcutLabels}
                editRequest={editRequest}
                blockedShortcutKeys={blockedShortcutKeys}
                blockedMidiNotes={blockedMidiNotes}
                blockedMidiCCs={blockedMidiCCs}
              />
            ) : (
              <div className={`flex items-center justify-center h-64 rounded-2xl border-2 border-dashed transition-all duration-300 ${theme === 'dark'
                ? 'bg-gray-800 border-gray-600'
                : 'bg-white border-gray-300'
                }`}>
                <p className={`text-center ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                  Select a bank from the sidebar to get started
                </p>
              </div>
            )
          )}
        </div>
      </div>

      {/* Error Dialog */}
      <Dialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <DialogContent className={`sm:max-w-md ${theme === 'dark' ? 'bg-gray-800 border-red-500' : 'bg-white border-red-500'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="text-red-600">Error</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
              {error}
            </p>
            <Button onClick={handleErrorClose} className="w-full">
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
