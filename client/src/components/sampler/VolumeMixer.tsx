import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Volume2, X, Square, Waves, SlidersHorizontal as Equalizer } from 'lucide-react';
import { ChannelState, PlayingPadInfo, StopMode } from './types/sampler';
import { createPortal } from 'react-dom';

/** ---------- Slide-down notification system (local to mixer) ---------- */
type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string }

function useNotices() {
  const [notices, setNotices] = React.useState<Notice[]>([])

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random())
    const notice: Notice = { id, ...n }
    setNotices((arr) => [notice, ...arr])
    // Auto-dismiss after 4s
    setTimeout(() => dismiss(id), 4000)
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((n) => n.id !== id))
  }, [])

  return { notices, pushNotice, dismiss }
}

function NoticesPortal(
  { notices, dismiss, theme }: { notices: Notice[]; dismiss: (id: string) => void; theme: 'light' | 'dark' }
) {
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
      <div className="w-full max-w-xl px-3">
        {notices.map((n) => (
          <NoticeItem key={n.id} notice={n} dismiss={dismiss} theme={theme} />
        ))}
      </div>
    </div>,
    document.body
  )
}

function NoticeItem({ notice, dismiss, theme }: { notice: Notice; dismiss: (id: string) => void; theme: 'light' | 'dark' }) {
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 10)
    return () => clearTimeout(t)
  }, [])

  const base = 'pointer-events-auto mt-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300'
  const colors =
    notice.variant === 'success'
      ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 text-white border-green-700')
      : notice.variant === 'error'
        ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 text-white border-red-700')
        : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 text-white border-gray-800')

  return (
    <div
      className={`${base} ${colors} ${show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(true)}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 text-sm">{notice.message}</div>
        <button
          className="text-white/80 hover:text-white"
          onClick={() => dismiss(notice.id)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  )
}

/** --------------------------------------------------------------------- */

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface VolumeMixerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelStates: ChannelState[];
  legacyPlayingPads: PlayingPadInfo[];
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
  onStopPad: (padId: string) => void;
  onChannelVolumeChange: (channelId: number, volume: number) => void;
  onStopChannel: (channelId: number) => void;
  eqSettings: EqSettings;
  onEqChange: (settings: EqSettings) => void;
  theme: 'light' | 'dark';
  windowWidth: number;
}

const msToMMSS = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export function VolumeMixer({
  open,
  onOpenChange,
  channelStates,
  legacyPlayingPads,
  masterVolume,
  onMasterVolumeChange,
  onPadVolumeChange,
  onStopPad,
  onChannelVolumeChange,
  onStopChannel,
  eqSettings,
  onEqChange,
  theme,
  windowWidth
}: VolumeMixerProps) {
  const [localChannelVolumes, setLocalChannelVolumes] = React.useState<number[]>([]);
  const channelVolumeRafRef = React.useRef<Map<number, number>>(new Map());
  const channelVolumePendingRef = React.useRef<Map<number, number>>(new Map());
  const masterVolumeRafRef = React.useRef<number | null>(null);
  const pendingMasterVolumeRef = React.useRef<number | null>(null);
  const eqRafRef = React.useRef<number | null>(null);
  const pendingEqRef = React.useRef<EqSettings | null>(null);
  
  // Slide notices
  const { notices, dismiss } = useNotices();

  const handleMasterVolumeDoubleClick = () => {
    if (masterVolumeRafRef.current !== null) {
      cancelAnimationFrame(masterVolumeRafRef.current);
      masterVolumeRafRef.current = null;
    }
    pendingMasterVolumeRef.current = null;
    onMasterVolumeChange(1); // Reset to 100%
  };

  const handleEqDoubleClick = (type: keyof EqSettings) => {
    if (eqRafRef.current !== null) {
      cancelAnimationFrame(eqRafRef.current);
      eqRafRef.current = null;
    }
    pendingEqRef.current = null;
    onEqChange({ ...eqSettings, [type]: 0 });
  };

  React.useEffect(() => {
    setLocalChannelVolumes((prev) => {
      if (prev.length !== channelStates.length) {
        return channelStates.map((channel) => channel.channelVolume);
      }
      return channelStates.map((channel, index) => {
        if (channelVolumePendingRef.current.has(channel.channelId)) {
          return prev[index] ?? channel.channelVolume;
        }
        return channel.channelVolume;
      });
    });
  }, [channelStates]);

  const scheduleChannelVolumeUpdate = React.useCallback(
    (channelId: number, volume: number) => {
      channelVolumePendingRef.current.set(channelId, volume);
      if (channelVolumeRafRef.current.has(channelId)) return;
      const rafId = requestAnimationFrame(() => {
        const next = channelVolumePendingRef.current.get(channelId);
        if (typeof next === 'number') {
          onChannelVolumeChange(channelId, next);
        }
        channelVolumePendingRef.current.delete(channelId);
        channelVolumeRafRef.current.delete(channelId);
      });
      channelVolumeRafRef.current.set(channelId, rafId);
    },
    [onChannelVolumeChange]
  );

  const handleChannelSliderChange = React.useCallback(
    (channelIndex: number, channelId: number, value: number) => {
      setLocalChannelVolumes((prev) => {
        const next = [...prev];
        next[channelIndex] = value;
        return next;
      });
      scheduleChannelVolumeUpdate(channelId, value);
    },
    [scheduleChannelVolumeUpdate]
  );

  const scheduleMasterVolumeUpdate = React.useCallback(
    (volume: number) => {
      pendingMasterVolumeRef.current = volume;
      if (masterVolumeRafRef.current !== null) return;
      masterVolumeRafRef.current = requestAnimationFrame(() => {
        const next = pendingMasterVolumeRef.current;
        if (typeof next === 'number') {
          onMasterVolumeChange(next);
        }
        pendingMasterVolumeRef.current = null;
        masterVolumeRafRef.current = null;
      });
    },
    [onMasterVolumeChange]
  );

  const scheduleEqUpdate = React.useCallback(
    (next: EqSettings) => {
      pendingEqRef.current = next;
      if (eqRafRef.current !== null) return;
      eqRafRef.current = requestAnimationFrame(() => {
        const pending = pendingEqRef.current;
        if (pending) {
          onEqChange(pending);
        }
        pendingEqRef.current = null;
        eqRafRef.current = null;
      });
    },
    [onEqChange]
  );

  React.useEffect(() => {
    return () => {
      channelVolumeRafRef.current.forEach((rafId) => cancelAnimationFrame(rafId));
      channelVolumeRafRef.current.clear();
      channelVolumePendingRef.current.clear();
      if (masterVolumeRafRef.current !== null) {
        cancelAnimationFrame(masterVolumeRafRef.current);
        masterVolumeRafRef.current = null;
      }
      pendingMasterVolumeRef.current = null;
      if (eqRafRef.current !== null) {
        cancelAnimationFrame(eqRafRef.current);
        eqRafRef.current = null;
      }
      pendingEqRef.current = null;
    };
  }, []);


  return (
    <>
      {/* Slide-down notifications */}
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <div className={`fixed inset-y-0 right-0 z-50 w-64 border-l transition-transform duration-300 will-change-transform ${theme === 'dark'
        ? 'bg-gray-800 border-gray-700'
        : 'bg-white border-gray-200'
        } ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className={`flex items-center justify-between p-4 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
          }`}>
          <div className="w-8" />

          <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            Mixer
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className={theme === 'dark'
              ? 'h-8 w-8 p-0 border border-red-500/50 bg-red-900/40 text-red-300 hover:bg-red-800/60 hover:text-red-100'
              : 'h-8 w-8 p-0 border border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700'}
            title="Close Mixer"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-6 max-h-[calc(100vh-80px)] overflow-y-auto">
          {/* Master Volume */}
          <div className="space-y-3">
            <Label
              className={`font-medium flex items-center gap-2 cursor-pointer ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}
              onDoubleClick={handleMasterVolumeDoubleClick}
              title="Double-click to reset to 100%"
            >
              <Volume2 className="w-4 h-4" />
              Master Volume: {Math.round(masterVolume * 100)}%
            </Label>
            <Slider
              value={[masterVolume * 100]}
              onValueChange={([value]) => scheduleMasterVolumeUpdate(value / 100)}
              max={100}
              min={0}
              step={1}
              className="w-full cursor-pointer"
              onDoubleClick={handleMasterVolumeDoubleClick}
              title="Double-click to reset"
            />
          </div>

          {/* Master EQ */}
          <div className="space-y-3">
            <Label className={`font-medium flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              <Equalizer className="w-4 h-4" />
              Master EQ
            </Label>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label
                  className="text-xs cursor-pointer"
                  onDoubleClick={() => handleEqDoubleClick('high')}
                  title="Double-click to reset"
                >
                  High: {eqSettings.high > 0 ? '+' : ''}{eqSettings.high}dB
                </Label>
              </div>
              <Slider
                value={[eqSettings.high]}
                onValueChange={([value]) => scheduleEqUpdate({ ...eqSettings, high: value })}
                max={12}
                min={-12}
                step={1}
                className="w-full cursor-pointer"
                onDoubleClick={() => handleEqDoubleClick('high')}
              />

              <div className="flex justify-between items-center">
                <Label
                  className="text-xs cursor-pointer"
                  onDoubleClick={() => handleEqDoubleClick('mid')}
                  title="Double-click to reset"
                >
                  Mid: {eqSettings.mid > 0 ? '+' : ''}{eqSettings.mid}dB
                </Label>
              </div>
              <Slider
                value={[eqSettings.mid]}
                onValueChange={([value]) => scheduleEqUpdate({ ...eqSettings, mid: value })}
                max={12}
                min={-12}
                step={1}
                className="w-full cursor-pointer"
                onDoubleClick={() => handleEqDoubleClick('mid')}
              />

              <div className="flex justify-between items-center">
                <Label
                  className="text-xs cursor-pointer"
                  onDoubleClick={() => handleEqDoubleClick('low')}
                  title="Double-click to reset"
                >
                  Low: {eqSettings.low > 0 ? '+' : ''}{eqSettings.low}dB
                </Label>
              </div>
              <Slider
                value={[eqSettings.low]}
                onValueChange={([value]) => scheduleEqUpdate({ ...eqSettings, low: value })}
                max={12}
                min={-12}
                step={1}
                className="w-full cursor-pointer"
                onDoubleClick={() => handleEqDoubleClick('low')}
              />
        </div>
          </div>

          {/* Currently Playing Pads */}
          <div className="space-y-3">
            <Label className={`font-medium flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
              <Waves className="w-4 h-4" />
              Channels ({channelStates.filter((c) => c.pad).length}/8)
            </Label>

            <div className="space-y-2 max-h-128 overflow-y-auto">
              {channelStates.map((channel, index) => {
                const playingPad = channel.pad;
                const pp = playingPad as PlayingPadInfo & { currentMs?: number; endMs?: number };
                const isActive = !!playingPad;
                const localVolume = localChannelVolumes[index] ?? channel.channelVolume;

                return (
                  <div
                    key={channel.channelId}
                    className={`p-2 rounded-lg border transition-all ${isActive
                      ? (theme === 'dark' ? 'bg-green-900 border-green-600' : 'bg-green-50 border-green-300')
                      : (theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-200')
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`text-xs font-semibold ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                        CH {channel.channelId}
                      </div>
                      <div className="flex-1 min-w-0" />
                      <Button
                        onClick={() => onStopChannel(channel.channelId)}
                        variant="outline"
                        size="sm"
                        disabled={!isActive}
                        className={`w-5 h-5 p-0 ${isActive
                          ? (theme === 'dark'
                            ? 'bg-red-500 border-red-400 text-red-100 hover:bg-red-600'
                            : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100')
                          : (theme === 'dark'
                            ? 'bg-gray-700 border-gray-600 text-gray-400'
                            : 'bg-gray-100 border-gray-200 text-gray-400')
                          } active:scale-95 active:brightness-90 transition-transform`}
                        title="Stop Channel"
                      >
                        <Square className="w-2.5 h-2.5" />
                      </Button>
                    </div>

                    <div className="space-y-1 mb-2">
                      <div className={`flex justify-between text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                        <span>Channel Vol</span>
                        <span>{Math.round(localVolume * 100)}%</span>
                      </div>
                      <Slider
                        value={[ localVolume * 100 ]}
                        onValueChange={([value]) => handleChannelSliderChange(index, channel.channelId, value / 100)}
                        max={100}
                        min={0}
                        step={1}
                        className="w-full cursor-pointer"
                        onDoubleClick={() => handleChannelSliderChange(index, channel.channelId, 1)}
                        title="Double-click to reset"
                      />
                    </div>

                    {isActive ? (
                      <>
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: playingPad.color }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className={`text-xs font-medium truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                                {playingPad.padName.length > 12 ? `${playingPad.padName.substring(0, 12)}...` : playingPad.padName}
                              </span>
                              <span className={`text-xs opacity-75 truncate ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                                {playingPad.bankName.length > 8 ? `${playingPad.bankName.substring(0, 8)}...` : playingPad.bankName}
                              </span>
                            </div>
                          </div>
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0" />
                        </div>

                        {/* Compact timestamp */}
                        <div className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                          {pp?.currentMs != null && pp?.endMs != null
                            ? `${msToMMSS(pp.currentMs)} - ${msToMMSS(pp.endMs)}`
                            : '—:— - —:—'}
                        </div>
                      </>
                    ) : (
                      <div className={`text-xs text-center py-2 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                        Empty
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {legacyPlayingPads.length > 0 && (
            <div className="space-y-3">
              <Label className={`font-medium flex items-center gap-2 ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                <Waves className="w-4 h-4" />
                Ignore Channel ({legacyPlayingPads.length})
              </Label>

              <div className="space-y-2 max-h-128 overflow-y-auto">
                {legacyPlayingPads.map((playingPad) => {
                  const pp = playingPad as PlayingPadInfo & { currentMs?: number; endMs?: number };
                return (
                  <div
                    key={playingPad.padId}
                    className={`p-2 rounded-lg border transition-all ${theme === 'dark'
                      ? 'bg-green-900 border-green-600'
                      : 'bg-green-50 border-green-300'
                      }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: playingPad.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <span className={`text-xs font-medium truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                            {playingPad.padName.length > 12 ? `${playingPad.padName.substring(0, 12)}...` : playingPad.padName}
                          </span>
                          <span className={`text-xs opacity-75 truncate ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                            {playingPad.bankName.length > 8 ? `${playingPad.bankName.substring(0, 8)}...` : playingPad.bankName}
                          </span>
                        </div>
                      </div>
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0" />
                      <Button
                        onClick={() => onStopPad(playingPad.padId)}
                        variant="outline"
                        size="sm"
                        className={`w-5 h-5 p-0 ${theme === 'dark'
                            ? 'bg-red-500 border-red-400 text-red-100 hover:bg-red-600'
                          : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
                          }`}
                        title="Stop"
                      >
                        <Square className="w-2.5 h-2.5" />
                      </Button>
                    </div>

                    <div className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                        {pp?.currentMs != null && pp?.endMs != null
                        ? `${msToMMSS(pp.currentMs)} - ${msToMMSS(pp.endMs)}`
                        : '—:— - —:—'}
                    </div>

                    <div className="space-y-1">
                      <div className={`flex justify-between text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                          <span>Pad Vol</span>
                        <span>{Math.round((playingPad.effectiveVolume ?? playingPad.volume) * 100)}%</span>
                      </div>
                      <Slider
                        value={[ (playingPad.effectiveVolume ?? playingPad.volume) * 100 ]}
                        onValueChange={([value]) => onPadVolumeChange(playingPad.padId, value / 100)}
                        max={100}
                        min={0}
                        step={1}
                        className="w-full cursor-pointer"
                        onDoubleClick={() => onPadVolumeChange(playingPad.padId, 1)}
                        title="Double-click to reset"
                      />
                    </div>
                  </div>
                );
              })}
              </div>
                </div>
              )}
            </div>
          </div>

    </>
  );
}
