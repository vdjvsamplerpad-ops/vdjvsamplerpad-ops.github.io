import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PadData, SamplerBank, StopMode } from './types/sampler';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { PadEditDialog } from './PadEditDialog';
import { PadTransferDialog } from './PadTransferDialog';
import { Play, Pause, MousePointer2, Zap, VolumeX } from 'lucide-react';
import { normalizeShortcutKey, normalizeStoredShortcutKey } from '@/lib/keyboard-shortcuts';

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface SamplerPadProps {
  pad: PadData;
  bankId: string;
  bankName: string;
  allBanks?: SamplerBank[];
  allPads?: PadData[];
  bankPads?: PadData[];
  editMode: boolean;
  globalMuted: boolean;
  masterVolume: number;
  theme: 'light' | 'dark';
  stopMode: StopMode;
  eqSettings: EqSettings;
  padSize?: number;
  onUpdatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  onRemovePad: (id: string) => void;
  onDragStart?: (e: React.DragEvent, pad: PadData, bankId: string) => void;
  onTransferPad?: (padId: string, sourceBankId: string, targetBankId: string) => void;
  availableBanks?: Array<{ id: string; name: string; }>;
  canTransferFromBank?: (bankId: string) => boolean;
  midiEnabled?: boolean;
  blockedShortcutKeys?: Set<string>;
  blockedMidiNotes?: Set<number>;
  blockedMidiCCs?: Set<number>;
  hideShortcutLabel?: boolean;
  editRequestToken?: number;
  channelLoadArmed?: boolean;
  onSelectPadForChannelLoad?: (pad: PadData, bankId: string, bankName: string) => void;
}

export function SamplerPad({
  pad,
  bankId,
  bankName,
  allBanks = [],
  allPads = [],
  bankPads = [],
  editMode,
  globalMuted,
  masterVolume,
  theme,
  stopMode,
  eqSettings,
  padSize = 5,
  onUpdatePad,
  onRemovePad,
  onDragStart,
  onTransferPad,
  availableBanks = [],
  canTransferFromBank,
  midiEnabled = false,
  blockedShortcutKeys,
  blockedMidiNotes,
  blockedMidiCCs,
  hideShortcutLabel = false,
  editRequestToken,
  channelLoadArmed = false,
  onSelectPadForChannelLoad
}: SamplerPadProps) {
  const audioPlayer = useAudioPlayer(
    pad,
    bankId,
    bankName,
    globalMuted,
    masterVolume,
    eqSettings
  );

  const { isPlaying, progress, effectiveVolume, playAudio, stopAudio, queueNextPlaySettings } = audioPlayer;
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [showTransferDialog, setShowTransferDialog] = React.useState(false);
  const [isHolding, setIsHolding] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const lastEditTokenRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (!editMode || !editRequestToken) return;
    if (lastEditTokenRef.current === editRequestToken) return;
    lastEditTokenRef.current = editRequestToken;
    setShowEditDialog(true);
  }, [editMode, editRequestToken]);

  const shortcutLabel = React.useMemo(() => {
    if (!pad.shortcutKey) return null;
    if (pad.shortcutKey.startsWith('Numpad')) {
      return `Num${pad.shortcutKey.replace('Numpad', '')}`;
    }
    return normalizeStoredShortcutKey(pad.shortcutKey) || normalizeShortcutKey(pad.shortcutKey) || pad.shortcutKey;
  }, [pad.shortcutKey]);

  const handlePadClick = (e: React.MouseEvent) => {
    // Don't handle pad click if clicking on the transfer indicator
    if ((e.target as HTMLElement).closest('.transfer-indicator')) {
      return;
    }

    if (channelLoadArmed && onSelectPadForChannelLoad) {
      onSelectPadForChannelLoad(pad, bankId, bankName);
      return;
    }

    if (editMode) {
      setShowEditDialog(true);
    } else if (pad.triggerMode === 'toggle') {
      if (isPlaying) stopAudio();
      else playAudio();
    } else if (pad.triggerMode !== 'hold') {
      playAudio();
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (editMode || channelLoadArmed) return;
    if ((e.target as HTMLElement).closest('.transfer-indicator')) {
      return;
    }

    if (pad.triggerMode === 'hold') {
      e.preventDefault();
      setIsHolding(true);
      playAudio();
    }
  };

  const handleMouseUp = () => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      stopAudio();
    }
  };

  const handleMouseLeave = () => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      stopAudio();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode === 'hold') {
      e.preventDefault();
      setIsHolding(true);
      playAudio();
    }
  };

  const handleTouchEnd = () => {
    if (editMode || channelLoadArmed) return;
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      stopAudio();
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (!editMode) {
      e.preventDefault();
      return;
    }

    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';

    // Set both data formats for better compatibility
    const transferData = {
      type: 'pad-transfer',
      pad: pad,
      sourceBankId: bankId
    };

    e.dataTransfer.setData('application/json', JSON.stringify(transferData));
    e.dataTransfer.setData('text/plain', JSON.stringify(transferData));

    console.log('Drag started for pad:', pad.id, 'from bank:', bankId);

    if (onDragStart) {
      onDragStart(e, pad, bankId);
    }
  };

  const handleDragEnd = () => {
    console.log('Drag ended for pad:', pad.id);
    setIsDragging(false);
  };

  const handleTransferClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    // Check if this bank allows transfers
    if (canTransferFromBank && !canTransferFromBank(bankId)) {
      return;
    }

    if (availableBanks.length > 1) { // Current bank + other banks
      setShowTransferDialog(true);
    }
  };

  const handleTransfer = (targetBankId: string) => {
    if (onTransferPad && targetBankId !== bankId) {
      console.log('Transferring pad:', pad.id, 'from:', bankId, 'to:', targetBankId);
      onTransferPad(pad.id, bankId, targetBankId);
    }
    setShowTransferDialog(false);
  };

  const handleSave = async (updatedPad: PadData) => {
    try {
      await onUpdatePad(bankId, pad.id, updatedPad);
      queueNextPlaySettings(updatedPad);
      setShowEditDialog(false);
    } catch (error) {
      console.error('Failed to save pad:', error);
    }
  };


  const handleUnload = () => {
    onRemovePad(pad.id);
    setShowEditDialog(false);
  };

  const handleImageError = () => {
    console.warn('Image failed to load for pad:', pad.id, pad.name);
    setImageError(true);
  };

  const handleImageLoad = () => {
    setImageError(false);
  };

  const nameLength = pad.name?.length || 0;
  const fontScale = nameLength > 40 ? 0.6 : nameLength > 30 ? 0.7 : nameLength > 22 ? 0.8 : nameLength > 16 ? 0.9 : 1;

  const getButtonOpacity = () => {
    if (pad.triggerMode === 'unmute' && isPlaying) {
      return 'opacity-60';
    }
    if (isDragging) {
      return 'opacity-50';
    }
    return '';
  };

  const shouldShowImage = pad.imageUrl && !imageError;
  const shouldShowText = !shouldShowImage;

  const getEditModeClasses = () => {
    if (editMode) {
      return 'ring-2 ring-orange-400 cursor-grab active:cursor-grabbing';
    }
    if (channelLoadArmed) {
      return 'ring-2 ring-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.35)] cursor-pointer';
    }
    return 'cursor-pointer';
  };

  const getEditModeButtonClasses = () => {
    return editMode ? '' : '';
  };

  const getEditModeButtonStyle = () => {
    if (editMode) {
      return { animationDelay: `${Math.random()}s` };
    }
    return {};
  };

  const getTriggerModeIcon = () => {
    // Smaller icons on mobile to maximize text space
    const iconSize = 'w-2 h-2 sm:w-3 sm:h-3';
    switch (pad.triggerMode) {
      case 'toggle':
        if (isPlaying) {
          return <Pause className={`${iconSize} text-blue-400`} />;
        } else {
          return <Play className={`${iconSize} text-blue-400`} />;
        }
      case 'hold':
        return <MousePointer2 className={`${iconSize} text-green-400`} />;
      case 'stutter':
        return <Zap className={`${iconSize} text-orange-400`} />;
      case 'unmute':
        return <VolumeX className={`${iconSize} text-purple-400`} />;
      default:
        return null;
    }
  };

  // Filter out current bank from available banks for transfer
  const transferableBanks = availableBanks.filter(bank => bank.id !== bankId);

  return (
    <>
      <Button
        onClick={handlePadClick}
        onMouseDown={pad.triggerMode === 'hold' && !editMode ? handleMouseDown : undefined}
        onMouseUp={pad.triggerMode === 'hold' && !editMode ? handleMouseUp : undefined}
        onMouseLeave={pad.triggerMode === 'hold' && !editMode ? handleMouseLeave : undefined}
        onTouchStart={pad.triggerMode === 'hold' && !editMode ? handleTouchStart : undefined}
        onTouchEnd={pad.triggerMode === 'hold' && !editMode ? handleTouchEnd : undefined}
        draggable={editMode}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        // Added title for native browser tooltip on hover (shows full name)
        title={shouldShowText ? pad.name : undefined}
        className={`
          w-full h-full min-h-[80px] font-bold border-2 relative overflow-hidden select-none rounded-[0.75rem]
          ${getButtonOpacity()} ${getEditModeClasses()} ${getEditModeButtonClasses()}
          perf-high:transition-all perf-high:duration-200 perf-high:ease-out 
          perf-medium:transition-colors perf-medium:duration-150 
          perf-low:transition-none
          perf-high:hover:scale-[1.01] perf-high:active:scale-[0.98]
          perf-high:shadow-sm perf-high:hover:shadow-md
          ${isDragging ? 'z-50' : ''}
          ${isPlaying
            ? 'border-green-300 text-white perf-high:shadow-[inset_0_0_20px_rgba(255,255,255,0.3)]'
            : theme === 'dark'
              ? 'border-white/10 text-white hover:border-white/30 perf-high:backdrop-blur-sm'
              : 'border-black/5 text-gray-900 hover:border-black/20 perf-high:backdrop-blur-sm'
          }
        `}
        style={{
          // Use slightly higher opacity (E6 = ~90%) for better contrast, allow backdrop-blur to show through
          backgroundColor: isPlaying ? '#4ade80' : `${pad.color}${theme === 'dark' ? 'CC' : 'E6'}`,
          ...getEditModeButtonStyle()
        }}
      >
        {shortcutLabel && !hideShortcutLabel && (
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide ${theme === 'dark'
            ? 'bg-gray-900/70 text-gray-100'
            : 'bg-white/70 text-gray-800'
            }`}>
            {shortcutLabel}
          </div>
        )}
        {channelLoadArmed && !editMode && (
          <div className={`absolute top-0.5 left-0.5 z-20 px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide ${theme === 'dark'
            ? 'bg-emerald-800/80 text-emerald-100'
            : 'bg-emerald-200/90 text-emerald-900'
            }`}>
            LOAD
          </div>
        )}
        {/* Drag/Transfer indicator for edit mode - smaller on mobile */}
        {editMode && (
          <div
            onClick={handleTransferClick}
            className={`transfer-indicator absolute top-0.5 left-0.5 sm:top-1 sm:left-1 p-0.5 sm:p-1 rounded-full transition-all hover:scale-110 z-10 ${transferableBanks.length > 0 && (!canTransferFromBank || canTransferFromBank(bankId))
              ? 'bg-orange-500 hover:bg-orange-400 cursor-pointer'
              : 'bg-gray-500 cursor-not-allowed'
              }`}
            title={
              transferableBanks.length > 0 && (!canTransferFromBank || canTransferFromBank(bankId))
                ? 'Click to transfer to another bank'
                : canTransferFromBank && !canTransferFromBank(bankId)
                  ? 'Transfers not allowed from this bank'
                  : 'No other banks available'
            }
            style={{ pointerEvents: 'auto' }}
          >
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 grid grid-cols-2 gap-0.5">
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
              <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-white rounded-full"></div>
            </div>
          </div>
        )}

        {/* Trigger Mode Indicator - smaller on mobile to maximize text space */}
        <div className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 p-0.5 sm:p-1 rounded-full bg-black bg-opacity-20 pointer-events-none z-10">
          <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 flex items-center justify-center">
            {getTriggerModeIcon()}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center h-full w-full pointer-events-none p-0 sm:p-2 overflow-hidden">
          {shouldShowImage ? (
            <div className="absolute inset-0 z-0">
              <img
                src={pad.imageUrl}
                alt={pad.name}
                className="w-full h-full object-cover rounded object-center"
                onError={handleImageError}
                onLoad={handleImageLoad}
              />
            </div>
          ) : shouldShowText ? (
            /* ENHANCED TEXT RENDERING - RESPONSIVE TO PAD SIZE:
               - Text fills entire pad space with absolute positioning
               - Viewport-relative font sizing for very small pads (uses clamp for min/max)
               - Zero padding on mobile to maximize space, minimal on desktop
               - Text scales with actual pad dimensions, not just padSize prop
               - Maximum lines allowed based on available space
               - Strong text shadows for readability
               - Tighter line height for better space utilization
            */
            <div className="absolute inset-0 flex items-center justify-center px-0 py-0 w-full h-full overflow-hidden">
              <span
                className={`text-center font-bold leading-[1.05] break-words whitespace-normal ${isPlaying
                  ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
                  : theme === 'dark'
                    ? 'text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
                    : 'text-gray-900 drop-shadow-[0_2px_4px_rgba(255,255,255,0.9)]'
                  }`}
                style={{
                  // Responsive font sizing that scales with viewport and pad size
                  // Uses clamp for min/max bounds, viewport units for scaling
                  // Minimum sizes ensure readability even on very small pads
                  fontSize: padSize <= 4
                    ? `clamp(${Math.round(12 * fontScale)}px, min(6vw, 6vh, 1.4em), ${Math.round(24 * fontScale)}px)`
                    : padSize <= 8
                      ? `clamp(${Math.round(11 * fontScale)}px, min(5vw, 5vh, 1.2em), ${Math.round(20 * fontScale)}px)`
                      : `clamp(${Math.round(10 * fontScale)}px, min(4vw, 4vh, 1.1em), ${Math.round(16 * fontScale)}px)`,
                  padding: '1px 2px',
                  maxWidth: 'calc(100% - 4px)',
                  maxHeight: '100%',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box'
                }}
              >
                {pad.name}
              </span>
            </div>
          ) : null}

          {/* Volume percentage - smaller and positioned at bottom on mobile, hidden if playing */}
          {!isPlaying && (
            <div
              className={`absolute bottom-0 right-0 opacity-75 whitespace-nowrap z-20 ${theme === 'dark'
                ? 'text-gray-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                : 'text-gray-600 drop-shadow-[0_1px_2px_rgba(255,255,255,0.8)]'
                }`}
              style={{ fontSize: 'clamp(7px, min(2vw, 2vh), 10px)', padding: '1px 2px' }}
            >
              {Math.round(pad.volume * 100)}%
            </div>
          )}

          {/* Progress bar - only show when playing, positioned at very bottom */}
          {isPlaying && (
            <div className="absolute bottom-0 left-0 right-0 px-0 w-full z-10">
              <Progress value={progress} className="h-0.5 sm:h-1 rounded-full" />
              <div
                className={`absolute bottom-0 right-0 opacity-75 whitespace-nowrap ${theme === 'dark'
                  ? 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                  : 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]'
                  }`}
                style={{ fontSize: 'clamp(7px, min(2vw, 2vh), 10px)', padding: '1px 2px' }}
              >
                {Math.round(effectiveVolume * 100)}%
              </div>
            </div>
          )}
        </div>
      </Button>

      {showEditDialog && (
        <PadEditDialog
          pad={pad}
          allBanks={allBanks}
          allPads={allPads}
          bankPads={bankPads}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          onSave={handleSave}
          onUnload={handleUnload}
          midiEnabled={midiEnabled}
          blockedShortcutKeys={blockedShortcutKeys}
          blockedMidiNotes={blockedMidiNotes}
          blockedMidiCCs={blockedMidiCCs}
        />
      )}

      {showTransferDialog && (
        <PadTransferDialog
          pad={pad}
          availableBanks={transferableBanks}
          open={showTransferDialog}
          onOpenChange={setShowTransferDialog}
          onTransfer={handleTransfer}
          theme={theme}
        />
      )}
    </>
  );
}
