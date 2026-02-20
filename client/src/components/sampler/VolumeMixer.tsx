import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  SlidersHorizontal as Equalizer,
  Square,
  Trash2,
  Volume2,
  Waves,
  X
} from 'lucide-react';
import { ChannelDeckState, PlayingPadInfo, StopMode } from './types/sampler';
import { loadWaveformPeaks, resampleWaveformPeaks } from '@/lib/waveform-peaks';

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface VolumeMixerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelStates: ChannelDeckState[];
  channelCount: number;
  legacyPlayingPads: PlayingPadInfo[];
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
  onStopPad: (padId: string) => void;
  onChannelVolumeChange: (channelId: number, volume: number) => void;
  onStopChannel: (channelId: number) => void;
  onPlayChannel: (channelId: number) => void;
  onPauseChannel: (channelId: number) => void;
  onSeekChannel: (channelId: number, ms: number) => void;
  onUnloadChannel: (channelId: number) => void;
  onArmChannelLoad: (channelId: number) => void;
  onCancelChannelLoad: () => void;
  armedLoadChannelId: number | null;
  onSetChannelHotcue: (channelId: number, slotIndex: number, ms: number | null) => void;
  onTriggerChannelHotcue: (channelId: number, slotIndex: number) => void;
  onSetChannelCollapsed: (channelId: number, collapsed: boolean) => void;
  stopMode: StopMode;
  editMode: boolean;
  eqSettings: EqSettings;
  onEqChange: (settings: EqSettings) => void;
  mixerEqCollapsed: boolean;
  onMixerEqCollapsedChange: (collapsed: boolean) => void;
  theme: 'light' | 'dark';
  windowWidth: number;
}

const HOTCUE_SLOTS = [0, 1, 2, 3] as const;
const HOTCUE_COLORS = [
  { marker: 'bg-red-500', activeDark: 'border-red-500 text-red-200 bg-red-500/20', activeLight: 'border-red-400 text-red-700 bg-red-50' },
  { marker: 'bg-blue-500', activeDark: 'border-blue-500 text-blue-200 bg-blue-500/20', activeLight: 'border-blue-400 text-blue-700 bg-blue-50' },
  { marker: 'bg-emerald-500', activeDark: 'border-emerald-500 text-emerald-200 bg-emerald-500/20', activeLight: 'border-emerald-400 text-emerald-700 bg-emerald-50' },
  { marker: 'bg-yellow-500', activeDark: 'border-yellow-500 text-yellow-200 bg-yellow-500/20', activeLight: 'border-yellow-400 text-yellow-700 bg-yellow-50' }
] as const;

const formatMs = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, '0');
  const seconds = (total % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const createFallbackState = (channelId: number): ChannelDeckState => ({
  channelId,
  loadedPadRef: null,
  isPlaying: false,
  isPaused: false,
  playheadMs: 0,
  durationMs: 0,
  channelVolume: 1,
  hotcuesMs: [null, null, null, null],
  hasLocalHotcueOverride: false,
  collapsed: false,
  waveformKey: null,
  pad: null
});

type WaveformTarget = { channelId: number; audioUrl: string; cacheKey: string };
const WAVEFORM_ANALYZE_STILL_RUNNING_MS = 12000;
const MIXER_WAVEFORM_LOG_PREFIX = '[VolumeMixerWaveform]';

const extractAudioUrlFromCacheKey = (cacheKey: string): string => {
  if (!cacheKey) return '';
  if (/^(blob:|data:|https?:|file:|\/)/.test(cacheKey)) return cacheKey;
  const splitAt = cacheKey.indexOf(':');
  if (splitAt < 0 || splitAt >= cacheKey.length - 1) return '';
  return cacheKey.slice(splitAt + 1);
};

const truncateLogValue = (value: string, maxLength: number = 140): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 24)}...${value.slice(-16)}`;
};

const logWaveformStatus = (message: string, details?: Record<string, unknown>) => {
  if (details) {
    console.info(`${MIXER_WAVEFORM_LOG_PREFIX} ${message}`, details);
    return;
  }
  console.info(`${MIXER_WAVEFORM_LOG_PREFIX} ${message}`);
};

export function VolumeMixer({
  open,
  onOpenChange,
  channelStates,
  channelCount,
  legacyPlayingPads,
  masterVolume,
  onMasterVolumeChange,
  onPadVolumeChange,
  onStopPad,
  onChannelVolumeChange,
  onStopChannel,
  onPlayChannel,
  onPauseChannel,
  onSeekChannel,
  onUnloadChannel,
  onArmChannelLoad,
  onCancelChannelLoad,
  armedLoadChannelId,
  onSetChannelHotcue,
  onTriggerChannelHotcue,
  onSetChannelCollapsed,
  stopMode,
  editMode,
  eqSettings,
  onEqChange,
  mixerEqCollapsed,
  onMixerEqCollapsedChange,
  theme,
  windowWidth
}: VolumeMixerProps) {
  const isMobile = windowWidth < 768;

  const channelStateKey = channelStates
    .map((channel) => [
      channel.channelId,
      channel.loadedPadRef?.bankId || '',
      channel.loadedPadRef?.padId || '',
      channel.pad?.padId || '',
      channel.pad?.audioUrl || '',
      channel.pad?.endMs || 0,
      channel.isPlaying ? 1 : 0,
      channel.isPaused ? 1 : 0,
      channel.playheadMs || 0,
      channel.durationMs || 0,
      channel.channelVolume,
      channel.collapsed ? 1 : 0,
      channel.waveformKey || '',
      ...channel.hotcuesMs.map((cue) => cue ?? '')
    ].join('~'))
    .join('||');

  const channelStateMap = React.useMemo(() => {
    const map = new Map<number, ChannelDeckState>();
    channelStates.forEach((channel) => map.set(channel.channelId, channel));
    return map;
  }, [channelStateKey, channelStates]);

  const visibleChannels = React.useMemo(() => {
    const items: ChannelDeckState[] = [];
    for (let i = 1; i <= channelCount; i += 1) {
      items.push(channelStateMap.get(i) || createFallbackState(i));
    }
    return items;
  }, [channelCount, channelStateMap]);

  const [channelVolumeDrafts, setChannelVolumeDrafts] = React.useState<Record<number, number>>({});
  const [channelWaveforms, setChannelWaveforms] = React.useState<Record<number, { key: string; peaks: number[] }>>({});
  const [waveformByKey, setWaveformByKey] = React.useState<Record<string, number[]>>({});
  const [waveformLoadingByChannel, setWaveformLoadingByChannel] = React.useState<Record<number, true>>({});
  const waveformRequestedKeyRef = React.useRef<Map<number, string>>(new Map());
  const waveformExpectedKeyRef = React.useRef<Map<number, string>>(new Map());
  const waveformStartedAtRef = React.useRef<Map<number, number>>(new Map());
  const waveformTimeoutRef = React.useRef<Map<number, number>>(new Map());
  const isMountedRef = React.useRef(true);
  const channelVolumeRafRef = React.useRef<Map<number, number>>(new Map());
  const pendingChannelVolumeRef = React.useRef<Map<number, number>>(new Map());
  const activeVolumeDragRef = React.useRef<Set<number>>(new Set());

  const clearWaveformWatch = React.useCallback((channelId: number) => {
    waveformStartedAtRef.current.delete(channelId);
    const timeoutId = waveformTimeoutRef.current.get(channelId);
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId);
      waveformTimeoutRef.current.delete(channelId);
    }
  }, []);

  const setWaveformLoading = React.useCallback((channelId: number, loading: boolean) => {
    setWaveformLoadingByChannel((prev) => {
      const current = prev[channelId] === true;
      if (current === loading) return prev;
      const next = { ...prev };
      if (loading) {
        next[channelId] = true;
      } else {
        delete next[channelId];
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      channelVolumeRafRef.current.forEach((rafId) => window.cancelAnimationFrame(rafId));
      channelVolumeRafRef.current.clear();
      pendingChannelVolumeRef.current.clear();
      waveformTimeoutRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
      waveformTimeoutRef.current.clear();
      waveformStartedAtRef.current.clear();
    };
  }, []);

  React.useEffect(() => {
    setChannelVolumeDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      const activeIds = new Set(visibleChannels.map((channel) => channel.channelId));

      visibleChannels.forEach((channel) => {
        if (activeVolumeDragRef.current.has(channel.channelId)) return;
        if (typeof next[channel.channelId] !== 'number' || Math.abs(next[channel.channelId] - channel.channelVolume) > 0.002) {
          next[channel.channelId] = channel.channelVolume;
          changed = true;
        }
      });

      Object.keys(next).forEach((key) => {
        const id = Number(key);
        if (!activeIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [visibleChannels]);

  const scheduleChannelVolume = React.useCallback((channelId: number, nextVolume: number) => {
    pendingChannelVolumeRef.current.set(channelId, nextVolume);
    if (channelVolumeRafRef.current.has(channelId)) return;
    const rafId = window.requestAnimationFrame(() => {
      channelVolumeRafRef.current.delete(channelId);
      const pending = pendingChannelVolumeRef.current.get(channelId);
      pendingChannelVolumeRef.current.delete(channelId);
      if (typeof pending !== 'number') return;
      onChannelVolumeChange(channelId, pending);
    });
    channelVolumeRafRef.current.set(channelId, rafId);
  }, [onChannelVolumeChange]);

  const flushChannelVolume = React.useCallback((channelId: number, nextVolume: number) => {
    const rafId = channelVolumeRafRef.current.get(channelId);
    if (typeof rafId === 'number') {
      window.cancelAnimationFrame(rafId);
      channelVolumeRafRef.current.delete(channelId);
    }
    pendingChannelVolumeRef.current.delete(channelId);
    onChannelVolumeChange(channelId, nextVolume);
  }, [onChannelVolumeChange]);

  const handleChannelVolumeDrag = React.useCallback((channelId: number, nextVolume: number) => {
    activeVolumeDragRef.current.add(channelId);
    setChannelVolumeDrafts((prev) => ({
      ...prev,
      [channelId]: nextVolume
    }));
    scheduleChannelVolume(channelId, nextVolume);
  }, [scheduleChannelVolume]);

  const handleChannelVolumeCommit = React.useCallback((channelId: number, nextVolume: number) => {
    activeVolumeDragRef.current.delete(channelId);
    flushChannelVolume(channelId, nextVolume);
  }, [flushChannelVolume]);

  const waveformTargets = React.useMemo<WaveformTarget[]>(() => {
    return visibleChannels.map((channel) => {
      const keyAudioUrl = extractAudioUrlFromCacheKey(channel.waveformKey || '');
      const audioUrl = channel.pad?.audioUrl || keyAudioUrl;
      const cacheKey = audioUrl
        ? (channel.waveformKey || `${channel.pad?.padId || channel.channelId}:${audioUrl}`)
        : '';
      return {
        channelId: channel.channelId,
        audioUrl,
        cacheKey
      };
    });
  }, [visibleChannels]);

  React.useEffect(() => {
    const targets = waveformTargets;
    const expected = new Map<number, string>();
    targets.forEach((target) => {
      if (target.cacheKey) {
        expected.set(target.channelId, target.cacheKey);
      }
    });
    waveformExpectedKeyRef.current = expected;
    setWaveformLoadingByChannel((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        const channelId = Number(id);
        if (!expected.has(channelId)) {
          delete next[channelId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    waveformRequestedKeyRef.current.forEach((key, channelId) => {
      const nextKey = expected.get(channelId);
      if (!nextKey || nextKey !== key) {
        logWaveformStatus('Drop stale waveform request', {
          channelId,
          staleKey: truncateLogValue(key),
          expectedKey: nextKey ? truncateLogValue(nextKey) : null
        });
        clearWaveformWatch(channelId);
        waveformRequestedKeyRef.current.delete(channelId);
        setWaveformLoading(channelId, false);
      }
    });

    setChannelWaveforms((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.keys(next).forEach((id) => {
        const channelId = Number(id);
        const nextKey = expected.get(channelId);
        if (!nextKey || next[channelId]?.key !== nextKey) {
          delete next[channelId];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    targets.forEach((target) => {
      const audioUrl = target.audioUrl;
      if (!audioUrl) return;
      if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) return;
      clearWaveformWatch(target.channelId);
      const startedAt = Date.now();
      waveformStartedAtRef.current.set(target.channelId, startedAt);
      waveformRequestedKeyRef.current.set(target.channelId, target.cacheKey);
      setWaveformLoading(target.channelId, true);
      const timeoutId = window.setTimeout(() => {
        if (!isMountedRef.current) return;
        const expectedKey = waveformExpectedKeyRef.current.get(target.channelId);
        const requestedKey = waveformRequestedKeyRef.current.get(target.channelId);
        if (expectedKey !== target.cacheKey || requestedKey !== target.cacheKey) return;
        const elapsedMs = Date.now() - startedAt;
        logWaveformStatus('Still analyzing waveform', {
          channelId: target.channelId,
          elapsedMs,
          cacheKey: truncateLogValue(target.cacheKey)
        });
      }, WAVEFORM_ANALYZE_STILL_RUNNING_MS);
      waveformTimeoutRef.current.set(target.channelId, timeoutId);
      logWaveformStatus('Waveform decode started', {
        channelId: target.channelId,
        cacheKey: truncateLogValue(target.cacheKey),
        audioUrl: truncateLogValue(audioUrl)
      });
      void loadWaveformPeaks(audioUrl, target.cacheKey)
        .then((waveform) => {
          if (!isMountedRef.current) return;
          const elapsedMs = Date.now() - startedAt;
          if (waveformExpectedKeyRef.current.get(target.channelId) !== target.cacheKey) {
            logWaveformStatus('Waveform result ignored (stale key)', {
              channelId: target.channelId,
              elapsedMs,
              cacheKey: truncateLogValue(target.cacheKey)
            });
            clearWaveformWatch(target.channelId);
            setWaveformLoading(target.channelId, false);
            if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) {
              waveformRequestedKeyRef.current.delete(target.channelId);
            }
            return;
          }
          clearWaveformWatch(target.channelId);
          setWaveformLoading(target.channelId, false);
          logWaveformStatus('Waveform decode complete', {
            channelId: target.channelId,
            elapsedMs,
            points: waveform.peaks.length,
            cacheKey: truncateLogValue(target.cacheKey)
          });
          setWaveformByKey((prev) => {
            const existingByKey = prev[target.cacheKey];
            const existingByAudio = prev[target.audioUrl];
            if (existingByKey === waveform.peaks && existingByAudio === waveform.peaks) return prev;
            return {
              ...prev,
              [target.cacheKey]: waveform.peaks,
              [target.audioUrl]: waveform.peaks
            };
          });
          setChannelWaveforms((prev) => {
            const existing = prev[target.channelId];
            if (existing?.key === target.cacheKey && existing.peaks === waveform.peaks) return prev;
            return {
              ...prev,
              [target.channelId]: {
                key: target.cacheKey,
                peaks: waveform.peaks
              }
            };
          });
        })
        .catch((error) => {
          if (!isMountedRef.current) return;
          const elapsedMs = Date.now() - startedAt;
          clearWaveformWatch(target.channelId);
          setWaveformLoading(target.channelId, false);
          if (waveformExpectedKeyRef.current.get(target.channelId) !== target.cacheKey) {
            logWaveformStatus('Waveform decode error ignored (stale key)', {
              channelId: target.channelId,
              elapsedMs,
              cacheKey: truncateLogValue(target.cacheKey),
              error: error instanceof Error ? error.message : String(error)
            });
            return;
          }
          if (waveformRequestedKeyRef.current.get(target.channelId) === target.cacheKey) {
            waveformRequestedKeyRef.current.delete(target.channelId);
          }
          logWaveformStatus('Waveform decode failed', {
            channelId: target.channelId,
            elapsedMs,
            cacheKey: truncateLogValue(target.cacheKey),
            error: error instanceof Error ? error.message : String(error)
          });
          console.warn(`Failed to decode mixer waveform for CH${target.channelId}:`, error);
        });
    });
  }, [clearWaveformWatch, setWaveformLoading, waveformTargets]);

  const waveformProfiles = React.useMemo(() => {
    const map = new Map<number, number[]>();
    visibleChannels.forEach((channel) => {
      const points = channel.collapsed ? 56 : 96;
      const targetKey = channel.waveformKey || (
        channel.pad?.audioUrl
          ? `${channel.pad?.padId || channel.channelId}:${channel.pad.audioUrl}`
          : ''
      );
      const entry = channelWaveforms[channel.channelId];
      const targetAudioUrl = channel.pad?.audioUrl || extractAudioUrlFromCacheKey(targetKey);
      let source: number[] | undefined;

      if (entry?.peaks?.length) {
        if (entry.key === targetKey) {
          source = entry.peaks;
        } else if (targetAudioUrl && extractAudioUrlFromCacheKey(entry.key) === targetAudioUrl) {
          // Guard against transient key drift while channel state updates.
          source = entry.peaks;
        }
      }

      if (!source && targetKey) {
        const keyed = waveformByKey[targetKey];
        if (Array.isArray(keyed) && keyed.length > 0) {
          source = keyed;
        }
      }

      if (!source && targetAudioUrl) {
        const keyedByUrl = waveformByKey[targetAudioUrl];
        if (Array.isArray(keyedByUrl) && keyedByUrl.length > 0) {
          source = keyedByUrl;
        }
      }

      if (!source && targetAudioUrl) {
        const keyedByAudio = Object.entries(waveformByKey).find(([key, peaks]) => (
          Array.isArray(peaks)
          && peaks.length > 0
          && extractAudioUrlFromCacheKey(key) === targetAudioUrl
        ));
        if (keyedByAudio) {
          source = keyedByAudio[1];
        }
      }

      if (!source && entry?.peaks?.length) {
        source = entry.peaks;
      }

      if (source && source.length > 0) {
        map.set(channel.channelId, resampleWaveformPeaks(source, points));
      } else {
        map.set(channel.channelId, []);
      }
    });
    return map;
  }, [channelWaveforms, visibleChannels, waveformByKey]);

  const handleWaveformSeek = React.useCallback((event: React.MouseEvent<HTMLDivElement>, channel: ChannelDeckState) => {
    const duration = Math.max(1, channel.pad?.endMs || channel.durationMs || 0);
    if (duration <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, 0, rect.width);
    const ratio = rect.width > 0 ? x / rect.width : 0;
    onSeekChannel(channel.channelId, ratio * duration);
  }, [onSeekChannel]);

  const handleHotcuePress = React.useCallback((channel: ChannelDeckState, slotIndex: number) => {
    if (editMode) {
      const existing = channel.hotcuesMs[slotIndex];
      if (typeof existing === 'number') {
        onSetChannelHotcue(channel.channelId, slotIndex, null);
      } else {
        onSetChannelHotcue(channel.channelId, slotIndex, Math.max(0, channel.playheadMs || 0));
      }
      return;
    }
    onTriggerChannelHotcue(channel.channelId, slotIndex);
  }, [editMode, onSetChannelHotcue, onTriggerChannelHotcue]);

  const panelClasses = theme === 'dark'
    ? 'bg-gray-800/95 border-gray-700 text-white perf-high:backdrop-blur-md'
    : 'bg-white/95 border-gray-200 text-gray-900 perf-high:backdrop-blur-md';

  const sectionClasses = theme === 'dark'
    ? 'bg-gray-900/60 border-gray-700 perf-high:backdrop-blur-sm shadow-sm'
    : 'bg-gray-50/60 border-gray-200 perf-high:backdrop-blur-sm shadow-sm';

  return (
    <div className={`fixed inset-y-0 right-0 z-50 w-[28rem] max-w-[95vw] border-l shadow-2xl transition-transform duration-300 ${panelClasses} ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className={`flex items-center justify-between px-4 py-3 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'}`}>
        <div>
          <h2 className="text-sm font-semibold">Mixer Engine V2</h2>
          <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
            {channelCount} loadable channels, stop mode: {stopMode}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => onOpenChange(false)}
          className={theme === 'dark'
            ? 'h-8 w-8 border-red-500/60 bg-red-900/30 text-red-300 hover:bg-red-800/60'
            : 'h-8 w-8 border-red-300 bg-red-50 text-red-600 hover:bg-red-100'}
          title="Close Mixer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-[calc(100vh-64px)] overflow-y-auto p-3 space-y-3">
        {editMode && (
          <div className={`rounded-md border px-3 py-2 text-xs font-semibold tracking-wide ${theme === 'dark' ? 'border-amber-500 bg-amber-600/20 text-amber-200' : 'border-amber-400 bg-amber-50 text-amber-800'}`}>
            HOTCUE SET MODE ACTIVE
            <div className={`mt-1 text-[11px] font-normal ${theme === 'dark' ? 'text-amber-100/90' : 'text-amber-700'}`}>
              Tap any hotcue button to set or clear at the current playhead.
            </div>
          </div>
        )}

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <Label className="text-xs font-semibold flex items-center gap-2">
              <Volume2 className="h-4 w-4" /> Master and EQ
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={() => onMixerEqCollapsedChange(!mixerEqCollapsed)}
            >
              {mixerEqCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>

          {!mixerEqCollapsed && (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">Master Volume {Math.round(masterVolume * 100)}%</div>
                <Slider
                  value={[masterVolume * 100]}
                  onValueChange={([value]) => onMasterVolumeChange(value / 100)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">High {eqSettings.high > 0 ? '+' : ''}{eqSettings.high}dB</div>
                <Slider
                  value={[eqSettings.high]}
                  onValueChange={([value]) => onEqChange({ ...eqSettings, high: value })}
                  min={-12}
                  max={12}
                  step={1}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">Mid {eqSettings.mid > 0 ? '+' : ''}{eqSettings.mid}dB</div>
                <Slider
                  value={[eqSettings.mid]}
                  onValueChange={([value]) => onEqChange({ ...eqSettings, mid: value })}
                  min={-12}
                  max={12}
                  step={1}
                />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">Low {eqSettings.low > 0 ? '+' : ''}{eqSettings.low}dB</div>
                <Slider
                  value={[eqSettings.low]}
                  onValueChange={([value]) => onEqChange({ ...eqSettings, low: value })}
                  min={-12}
                  max={12}
                  step={1}
                />
              </div>
            </div>
          )}
        </section>

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <Label className="text-xs font-semibold flex items-center gap-2 mb-2">
            <Equalizer className="h-4 w-4" />
            Channel Decks
          </Label>
          <div className="space-y-2">
            {visibleChannels.map((channel) => {
              const loaded = Boolean(channel.pad && channel.loadedPadRef);
              const duration = Math.max(1, channel.pad?.endMs || channel.durationMs || 0);
              const playhead = clamp(channel.playheadMs || 0, 0, duration);
              const progressPct = duration > 0 ? (playhead / duration) * 100 : 0;
              const isLoadArmed = armedLoadChannelId === channel.channelId;
              const isOtherChannelArmed = armedLoadChannelId !== null && armedLoadChannelId !== channel.channelId;
              const waveform = waveformProfiles.get(channel.channelId) || [];
              const isWaveformLoading = waveformLoadingByChannel[channel.channelId] === true;
              const displayedVolume = clamp(
                typeof channelVolumeDrafts[channel.channelId] === 'number'
                  ? channelVolumeDrafts[channel.channelId]
                  : channel.channelVolume,
                0,
                1
              );

              return (
                <div
                  key={channel.channelId}
                  className={`rounded-md border ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'} ${channel.collapsed ? 'p-2' : 'p-2.5'}`}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${theme === 'dark' ? 'bg-gray-700 text-gray-200' : 'bg-gray-100 text-gray-700'}`}>
                      CH {channel.channelId}
                    </div>
                    <div className="min-w-0 flex-1 text-[11px] truncate" title={channel.pad ? `${channel.pad.padName} (${channel.pad.bankName})` : 'No sampler loaded'}>
                      {channel.pad ? `${channel.pad.padName} (${channel.pad.bankName})` : 'No sampler loaded'}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={`h-7 px-2 text-[10px] ${isLoadArmed
                        ? (theme === 'dark'
                          ? 'border-emerald-400 bg-emerald-900/40 text-emerald-200'
                          : 'border-emerald-400 bg-emerald-50 text-emerald-700')
                        : ''}`}
                      onClick={() => {
                        if (isLoadArmed) onCancelChannelLoad();
                        else onArmChannelLoad(channel.channelId);
                      }}
                    >
                      {isLoadArmed ? 'Waiting Pad...' : 'Load'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onSetChannelCollapsed(channel.channelId, !channel.collapsed)}
                      title={channel.collapsed ? 'Expand channel' : 'Collapse channel'}
                    >
                      {channel.collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                    </Button>
                  </div>

                  {(isLoadArmed || isOtherChannelArmed) && (
                    <div className={`mt-1 text-[10px] ${theme === 'dark' ? 'text-emerald-300/90' : 'text-emerald-700'}`}>
                      {isLoadArmed
                        ? `Tap highlighted pad to load CH ${channel.channelId}.`
                        : `CH ${armedLoadChannelId} is waiting for pad selection.`}
                    </div>
                  )}

                  <div className="mt-1.5 flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => (channel.isPlaying ? onPauseChannel(channel.channelId) : onPlayChannel(channel.channelId))}
                      disabled={!loaded}
                      title={channel.isPlaying ? 'Pause' : 'Play'}
                    >
                      {channel.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onStopChannel(channel.channelId)}
                      disabled={!loaded}
                      title="Stop"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onUnloadChannel(channel.channelId)}
                      disabled={!loaded}
                      title="Unload"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <div className="min-w-0 flex-1 text-[10px] text-right text-gray-500 dark:text-gray-400">
                      {formatMs(playhead)} / {formatMs(duration)}
                    </div>
                  </div>

                  <div
                    className={`relative mt-1.5 rounded border cursor-pointer overflow-hidden ${channel.collapsed ? 'h-4' : 'h-11'} ${theme === 'dark' ? 'border-gray-700 bg-gray-900' : 'border-gray-300 bg-gray-100'}`}
                    onClick={(event) => handleWaveformSeek(event, channel)}
                    title={loaded ? 'Seek using waveform' : 'Load a sampler first'}
                  >
                    {!channel.collapsed && waveform.length > 0 && (
                      <div className="absolute inset-0 flex items-end gap-[1px] px-1 py-1 pointer-events-none">
                        {waveform.map((height, index) => (
                          <div
                            key={`${channel.channelId}-wf-${index}`}
                            className={theme === 'dark' ? 'w-full bg-cyan-200/25' : 'w-full bg-cyan-800/20'}
                            style={{ height: `${Math.max(8, Math.round(Math.max(0, height) * 100))}%` }}
                          />
                        ))}
                      </div>
                    )}

                    {!channel.collapsed && loaded && isWaveformLoading && waveform.length === 0 && (
                      <div className={`absolute inset-0 flex items-center justify-center text-[10px] pointer-events-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                        Analyzing waveform...
                      </div>
                    )}

                    <div
                      className={`absolute inset-y-0 left-0 transition-[width] duration-100 ease-linear ${theme === 'dark' ? 'bg-cyan-300/25' : 'bg-cyan-400/25'}`}
                      style={{ width: `${progressPct}%` }}
                    />

                    <div
                      className={`absolute inset-y-0 w-[2px] transition-[left] duration-100 ease-linear ${theme === 'dark' ? 'bg-cyan-300' : 'bg-cyan-600'}`}
                      style={{ left: `${progressPct}%` }}
                    />

                    {HOTCUE_SLOTS.map((slotIndex) => {
                      const cue = channel.hotcuesMs[slotIndex];
                      if (typeof cue !== 'number') return null;
                      const cuePct = clamp((cue / duration) * 100, 0, 100);
                      const color = HOTCUE_COLORS[slotIndex];
                      if (channel.collapsed) {
                        return (
                          <div
                            key={`${channel.channelId}-cue-dot-${slotIndex}`}
                            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full border border-black/35 ${color.marker}`}
                            style={{ left: `${cuePct}%` }}
                          />
                        );
                      }
                      return (
                        <div
                          key={`${channel.channelId}-cue-line-${slotIndex}`}
                          className={`absolute inset-y-0 w-[2px] ${color.marker}`}
                          style={{ left: `${cuePct}%` }}
                        />
                      );
                    })}
                  </div>

                  {!channel.collapsed && (
                    <div className="mt-1.5 grid grid-cols-4 gap-1">
                      {HOTCUE_SLOTS.map((slotIndex) => {
                        const cue = channel.hotcuesMs[slotIndex];
                        const hasCue = typeof cue === 'number';
                        const color = HOTCUE_COLORS[slotIndex];
                        const activeClass = theme === 'dark' ? color.activeDark : color.activeLight;
                        return (
                          <Button
                            key={`${channel.channelId}-hotcue-${slotIndex}`}
                            type="button"
                            variant="outline"
                            size="sm"
                            className={`h-8 px-0 text-[11px] ${hasCue ? activeClass : ''} ${editMode && !hasCue ? (theme === 'dark' ? 'border-amber-500/70 text-amber-300' : 'border-amber-400 text-amber-700') : ''}`}
                            onClick={() => handleHotcuePress(channel, slotIndex)}
                            disabled={!loaded}
                            title={editMode
                              ? (hasCue ? `Clear C${slotIndex + 1}` : `Set C${slotIndex + 1}`)
                              : (hasCue ? `Jump to ${formatMs(cue || 0)}` : `C${slotIndex + 1} not set`)}
                          >
                            C{slotIndex + 1}
                          </Button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-1.5 space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                      <span>Channel Volume</span>
                      <span>{Math.round(displayedVolume * 100)}%</span>
                    </div>
                    <Slider
                      value={[displayedVolume * 100]}
                      min={0}
                      max={100}
                      step={0.1}
                      onValueChange={([value]) => handleChannelVolumeDrag(channel.channelId, value / 100)}
                      onValueCommit={([value]) => handleChannelVolumeCommit(channel.channelId, value / 100)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className={`rounded-lg border p-3 ${sectionClasses}`}>
          <Label className="text-xs font-semibold flex items-center gap-2 mb-2">
            <Waves className="h-4 w-4" /> Current Playing Sampler
          </Label>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {legacyPlayingPads.length === 0 && (
              <div className="text-xs text-gray-500 dark:text-gray-400">No pad-grid playback running.</div>
            )}
            {legacyPlayingPads.map((pad) => {
              const duration = Math.max(1, pad.endMs || 0);
              const progress = clamp(pad.currentMs || 0, 0, duration);
              return (
                <div key={pad.padId} className={`rounded-md border p-2 ${theme === 'dark' ? 'border-gray-700 bg-gray-950/40' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate">{pad.padName}</div>
                      <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{pad.bankName}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => onStopPad(pad.padId)}
                      title="Stop pad"
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  </div>
                  {!isMobile && (
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-500 dark:text-gray-400">
                        <span>{formatMs(progress)} / {formatMs(duration)}</span>
                        <span>{Math.round((pad.effectiveVolume ?? pad.volume) * 100)}%</span>
                      </div>
                      <Slider
                        value={[pad.volume * 100]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={([value]) => onPadVolumeChange(pad.padId, value / 100)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
