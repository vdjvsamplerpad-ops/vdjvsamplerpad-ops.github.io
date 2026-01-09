import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Menu, Pencil, Volume2, VolumeX, Square, Sliders, Shield } from 'lucide-react';
import { SamplerBank } from './types/sampler';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { createPortal } from 'react-dom'
import { useAuth } from '@/hooks/useAuth';


interface HeaderControlsProps {
  primaryBank: SamplerBank | null;
  secondaryBank: SamplerBank | null;
  currentBank: SamplerBank | null;
  isDualMode: boolean;
  editMode: boolean;
  globalMuted: boolean;
  sideMenuOpen: boolean;
  mixerOpen: boolean;
  theme: 'light' | 'dark';
  windowWidth: number;
  onFileUpload: (file: File, targetBankId?: string) => void;
  onToggleEditMode: () => void;
  onToggleMute: () => void;
  onStopAll: () => void;
  onToggleSideMenu: () => void;
  onToggleMixer: () => void;
  onToggleTheme: () => void;
  onExitDualMode: () => void;
}

/** ---------- Slide-down notification system (local to header) ---------- */
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

  const base = 'pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg transition-all duration-300'
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

export function HeaderControls({
  primaryBank,
  secondaryBank,
  currentBank,
  isDualMode,
  editMode,
  globalMuted,
  sideMenuOpen,
  mixerOpen,
  theme,
  windowWidth,
  onFileUpload,
  onToggleEditMode,
  onToggleMute,
  onStopAll,
  onToggleSideMenu,
  onToggleMixer,
  onToggleTheme,
  onExitDualMode
}: HeaderControlsProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [adminDialogOpen, setAdminDialogOpen] = React.useState(false);
  const [AdminAccessDialog, setAdminAccessDialog] = React.useState<React.ComponentType<any> | null>(null);

  // Dynamically load AdminAccessDialog only for admin users
  React.useEffect(() => {
    if (isAdmin && !AdminAccessDialog) {
      import('./AdminAccessDialog').then((module) => {
        setAdminAccessDialog(() => module.AdminAccessDialog);
      }).catch((error) => {
        console.error('Failed to load AdminAccessDialog:', error);
      });
    }
  }, [isAdmin, AdminAccessDialog]);

  // Slide notices
  const { notices, pushNotice, dismiss } = useNotices()

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type.startsWith('audio/')) {
          try {
            await onFileUpload(file);
          } catch (error) {
            console.error('Failed to upload file:', file.name, error);
          }
        }
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const isMobileScreen = windowWidth < 1160;

  const getTimeBasedGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getTitleText = () => {
    // Default title for all users
    return isMobileScreen ? 'VDJV' : 'VDJV Sampler Pad';
  };

  const getBankDisplayName = () => {
    if (isDualMode) {
      return `${primaryBank?.name || 'None'} | ${secondaryBank?.name || 'None'}`;
    } else {
      return currentBank?.name || 'No bank selected';
    }
  };

  return (
    <>
      {/* Slide-down notifications */}
      <NoticesPortal notices={notices} dismiss={dismiss} theme={theme} />

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      <header className="text-center mb-6">
        <div className="flex items-center justify-center gap-4 mb-1">
          <img
            src="./assets/logo.png"
            alt="VDJV Logo"
            className="w-12 h-12 object-contain"
          />
          <h1 className={`font-bold text-red-600 ${isMobileScreen
            ? 'text-m'
            : isMobileScreen
              ? 'text-l'
              : windowWidth < 1024
                ? 'text-xl'
                : 'text-2xl xl:text-3xl'
            }`}>
            {getTitleText()}
          </h1>
        </div>

        <div className={`mb-1 text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
          {isDualMode ? (
            <div className="flex items-center justify-center gap-2">
              <span className="text-blue-600 font-medium">Primary:</span>
              <span>{primaryBank?.name || 'None'}</span>
              <span className="text-gray-400">|</span>
              <span className="text-purple-600 font-medium">Secondary:</span>
              <span>{secondaryBank?.name || 'None'}</span>
            </div>
          ) : (
            <span>Bank: {getBankDisplayName()}</span>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-2">
          {/* Banks Menu Button */}
          <Button
            onClick={onToggleSideMenu}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${sideMenuOpen
              ? theme === 'dark'
                ? 'bg-indigo-500 border-indigo-400 text-indigo-300'
                : 'bg-indigo-50 border-indigo-300 text-indigo-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-indigo-500 hover:border-indigo-400 hover:text-indigo-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600'
              }`}
          >
            <Menu className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Banks')}
          </Button>

          {/* Upload Button */}
          <Button
            onClick={handleUploadClick}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${theme === 'dark'
              ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-teal-500 hover:border-teal-400 hover:text-teal-300'
              : 'bg-white border-gray-300 text-gray-700 hover:bg-teal-50 hover:border-teal-300 hover:text-teal-600'
              }`}
          >
            <Upload className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Upload')}
          </Button>

          {/* Edit Mode Toggle */}
          <Button
            onClick={onToggleEditMode}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${editMode
              ? theme === 'dark'
                ? 'bg-orange-500 border-orange-400 text-orange-300'
                : 'bg-orange-50 border-orange-300 text-orange-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-orange-500 hover:border-orange-400 hover:text-orange-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-orange-50 hover:border-orange-300 hover:text-orange-600'
              }`}
          >
            <Pencil className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : editMode ? 'Exit Edit' : 'Edit')}
          </Button>

          {/* Mute/Unmute Button */}
          <Button
            onClick={onToggleMute}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${globalMuted
              ? theme === 'dark'
                ? 'bg-red-500 border-red-400 text-red-300'
                : 'bg-red-50 border-red-300 text-red-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-purple-500 hover:border-purple-400 hover:text-purple-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-purple-50 hover:border-purple-300 hover:text-purple-600'
              }`}
          >
            {globalMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
            {!isMobileScreen && (isMobileScreen ? '' : globalMuted ? 'Unmute' : 'Mute')}
          </Button>

          {/* Stop All Button */}
          <Button
            onClick={onStopAll}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${theme === 'dark'
              ? 'bg-red-500 border-red-400 text-red-400 hover:bg-red-600'
              : 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
              }`}
          >
            <Square className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Stop All')}
          </Button>

          {/* Mixer Button */}
          <Button
            onClick={onToggleMixer}
            variant="outline"
            size={isMobileScreen ? "sm" : "default"}
            className={`${isMobileScreen ? 'w-10' : 'w-24'} transition-all duration-200 ${mixerOpen
              ? theme === 'dark'
                ? 'bg-green-500 border-green-400 text-green-300'
                : 'bg-green-50 border-green-300 text-green-600'
              : theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-green-500 hover:border-green-400 hover:text-green-300'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-green-50 hover:border-green-300 hover:text-green-600'
              }`}
          >
            <Sliders className="w-4 h-4" />
            {!isMobileScreen && (isMobileScreen ? '' : 'Mixer')}
          </Button>

          {/* Admin Access (admin-only) */}
          {isAdmin && (
            <Button
              onClick={() => setAdminDialogOpen(true)}
              variant="outline"
              size={isMobileScreen ? "sm" : "default"}
              className={`${isMobileScreen ? 'w-10' : 'w-40'} transition-all duration-200 ${theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-yellow-500 hover:border-yellow-400 hover:text-yellow-200'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-yellow-50 hover:border-yellow-300 hover:text-yellow-700'
                }`}
              title="Manage bank access"
            >
              <Shield className="w-4 h-4" />
              {!isMobileScreen && 'Admin Access'}
            </Button>
          )}
        </div>
      </header>

      {isAdmin && AdminAccessDialog && (
        <AdminAccessDialog open={adminDialogOpen} onOpenChange={setAdminDialogOpen} theme={theme} />
      )}
    </>
  );
}
