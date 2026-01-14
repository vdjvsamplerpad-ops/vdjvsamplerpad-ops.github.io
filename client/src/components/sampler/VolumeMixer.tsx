import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Volume2, X, Square, Waves, SlidersHorizontal as Equalizer, LogOut } from 'lucide-react';
import { PlayingPadInfo, StopMode } from './types/sampler';
import { useAuth } from '@/hooks/useAuth';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
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
  playingPads: PlayingPadInfo[];
  masterVolume: number;
  onMasterVolumeChange: (volume: number) => void;
  onPadVolumeChange: (padId: string, volume: number) => void;
  onStopPad: (padId: string) => void;
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
  playingPads,
  masterVolume,
  onMasterVolumeChange,
  onPadVolumeChange,
  onStopPad,
  eqSettings,
  onEqChange,
  theme,
  windowWidth
}: VolumeMixerProps) {
  const { user, loading, signOut } = useAuth();
  const [showLogoutConfirm, setShowLogoutConfirm] = React.useState(false);
  
  // Slide notices
  const { notices, pushNotice, dismiss } = useNotices();

  const handleMasterVolumeDoubleClick = () => {
    onMasterVolumeChange(1); // Reset to 100%
  };

  const handleEqDoubleClick = (type: keyof EqSettings) => {
    onEqChange({ ...eqSettings, [type]: 0 });
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = async () => {
    setShowLogoutConfirm(false);
    const { error } = await signOut();
    if (error) {
      pushNotice({ variant: 'error', message: 'Logout failed. Please try again.' })
    } else {
      pushNotice({ variant: 'success', message: 'Logged out successfully.' })
    }
  };

  return (
    <>
      {/* Slide-down notifications */}
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <div className={`fixed inset-y-0 right-0 z-50 w-64 border-l transition-all duration-300 ${theme === 'dark'
        ? 'bg-gray-800 border-gray-700'
        : 'bg-white border-gray-200'
        } ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className={`flex items-center justify-between p-4 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
          }`}>
          {/* Logout Button (only shown when logged in) */}
          {user ? (
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              disabled={loading}
              className={`transition-all duration-200 ${theme === 'dark'
                ? 'bg-red-600/20 border-red-500 text-red-300 hover:bg-red-500 hover:border-red-400 hover:text-red-200'
                : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100 hover:border-red-400 hover:text-red-700'
                }`}
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          ) : (
            <div className="w-8" /> /* Spacer when not logged in */
          )}

          <h2 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            Mixer
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className={theme === 'dark' ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}
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
              onValueChange={([value]) => onMasterVolumeChange(value / 100)}
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
                onValueChange={([value]) => onEqChange({ ...eqSettings, high: value })}
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
                onValueChange={([value]) => onEqChange({ ...eqSettings, mid: value })}
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
                onValueChange={([value]) => onEqChange({ ...eqSettings, low: value })}
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
              Currently Playing ({playingPads.length})
            </Label>

            <div className="space-y-2 max-h-128 overflow-y-auto">
              {playingPads.map((playingPad) => {
                // 👇 add this local, typed view so we can read currentMs/endMs
                const pp = playingPad as typeof playingPad & { currentMs?: number; endMs?: number };

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
                          ? 'bg-red-500 border-red-400 text-red-400 hover:bg-red-600'
                          : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
                          }`}
                        title="Stop"
                      >
                        <Square className="w-2.5 h-2.5" />
                      </Button>
                    </div>

                    {/* Compact timestamp */}
                    <div className={`text-xs mb-1 ${theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
                      {pp.currentMs != null && pp.endMs != null
                        ? `${msToMMSS(pp.currentMs)} - ${msToMMSS(pp.endMs)}`
                        : '—:— - —:—'}
                    </div>

                    <div className="space-y-1">
                      <div className={`flex justify-between text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
                        <span>Vol</span>
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

              {playingPads.length === 0 && (
                <div className="text-center py-6">
                  <p className={theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}>
                    No pads currently playing
                  </p>
                  <p className={`text-xs ${theme === 'dark' ? 'text-gray-500' : 'text-gray-500'}`}>
                    Start playing some pads to see controls here
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Logout Confirmation */}
      <ConfirmationDialog
        open={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
        title="Sign out"
        description="Are you sure you want to sign out?"
        confirmText="Sign out"
        variant="destructive"
        onConfirm={confirmLogout}
        theme={theme}
      />
    </>
  );
}
