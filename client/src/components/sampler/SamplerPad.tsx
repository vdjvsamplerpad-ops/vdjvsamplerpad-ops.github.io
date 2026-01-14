import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PadData, StopMode } from './types/sampler';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { PadEditDialog } from './PadEditDialog';
import { PadTransferDialog } from './PadTransferDialog';
import { Play, Pause, MousePointer2, Zap, VolumeX } from 'lucide-react';

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface SamplerPadProps {
  pad: PadData;
  bankId: string;
  bankName: string;
  allPads?: PadData[];
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
}

export function SamplerPad({
  pad,
  bankId,
  bankName,
  allPads = [],
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
  canTransferFromBank
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

  const handlePadClick = (e: React.MouseEvent) => {
    // Don't handle pad click if clicking on the transfer indicator
    if ((e.target as HTMLElement).closest('.transfer-indicator')) {
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
    if (editMode) return;
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
    if (editMode) return;
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      stopAudio();
    }
  };

  const handleMouseLeave = () => {
    if (editMode) return;
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      stopAudio();
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (editMode) return;
    if (pad.triggerMode === 'hold') {
      e.preventDefault();
      setIsHolding(true);
      playAudio();
    }
  };

  const handleTouchEnd = () => {
    if (editMode) return;
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

  const getTextProps = () => {
    let textSize = 'text-sm';
    let lineClamp = 'line-clamp-2';

    if (padSize <= 2) {
      textSize = 'text-lg';
      lineClamp = 'line-clamp-4';
    } else if (padSize <= 6) {
      textSize = 'text-base';
      lineClamp = 'line-clamp-3';
    } else if (padSize <= 10) {
      textSize = 'text-sm';
      lineClamp = 'line-clamp-2';
    } else {
      textSize = 'text-[10px]'; // Smaller for very dense grids
      lineClamp = 'line-clamp-2';
    }

    return { textSize, lineClamp };
  };

  const { textSize, lineClamp } = getTextProps();

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
    switch (pad.triggerMode) {
      case 'toggle':
        if (isPlaying) {
          return <Pause className="w-3 h-3 text-blue-400" />;
        } else {
          return <Play className="w-3 h-3 text-blue-400" />;
        }
      case 'hold':
        return <MousePointer2 className="w-3 h-3 text-green-400" />;
      case 'stutter':
        return <Zap className="w-3 h-3 text-orange-400" />;
      case 'unmute':
        return <VolumeX className="w-3 h-3 text-purple-400" />;
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
          w-full h-full min-h-[80px] font-bold border-2 transition-colors duration-150 relative overflow-hidden select-none
          ${getButtonOpacity()} ${getEditModeClasses()} ${getEditModeButtonClasses()}
          ${isDragging ? 'z-50' : ''}
          ${isPlaying
            ? 'bg-green-400 border-green-300 text-white'
            : theme === 'dark'
              ? 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:border-gray-500 text-white'
              : 'bg-white border-gray-300 hover:bg-gray-100 hover:border-gray-400 text-gray-900'
          }
        `}
        style={{
          backgroundColor: isPlaying ? undefined : `${pad.color}CC`,
          ...getEditModeButtonStyle()
        }}
      >
        {/* Drag/Transfer indicator for edit mode */}
        {editMode && (
          <div
            onClick={handleTransferClick}
            className={`transfer-indicator absolute top-1 left-1 p-1 rounded-full transition-all hover:scale-110 z-10 ${
              transferableBanks.length > 0 && (!canTransferFromBank || canTransferFromBank(bankId))
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
            <div className="w-3 h-3 grid grid-cols-2 gap-0.5">
              <div className="w-1 h-1 bg-white rounded-full"></div>
              <div className="w-1 h-1 bg-white rounded-full"></div>
              <div className="w-1 h-1 bg-white rounded-full"></div>
              <div className="w-1 h-1 bg-white rounded-full"></div>
            </div>
          </div>
        )}

        {/* Trigger Mode Indicator */}
        <div className="absolute top-1 right-1 p-1 rounded-full bg-black bg-opacity-20 pointer-events-none">
          {getTriggerModeIcon()}
        </div>

        <div className="flex flex-col items-center justify-center h-full w-full pointer-events-none p-2 overflow-hidden">
          {shouldShowImage ? (
            <div className="relative w-full max-w-[100%] aspect-square mb-1">
              <img
                src={pad.imageUrl}
                alt={pad.name}
                className="w-full h-full object-cover rounded object-center"
                onError={handleImageError}
                onLoad={handleImageLoad}
              />
            </div>
          ) : shouldShowText ? (
            /* UPDATED TEXT RENDERING:
               - whitespace-normal: Allows text to wrap naturally
               - break-words: Breaks long strings (like "KickDrum001")
               - line-clamp-x: Limits lines to keep layout clean
               - leading-tight: Tighter line height for better density
            */
            <div className="w-full flex items-center justify-center mb-1 overflow-hidden">
              <span className={`text-center font-bold leading-tight break-words whitespace-normal ${textSize} ${lineClamp} ${isPlaying
                ? 'text-white'
                : theme === 'dark'
                  ? 'text-white'
                  : 'text-gray-900'
                }`}>
                {pad.name}
              </span>
            </div>
          ) : null}

          <div className={`text-xs opacity-75 whitespace-nowrap ${isPlaying
            ? 'text-white'
            : theme === 'dark'
              ? 'text-gray-300'
              : 'text-gray-600'
            }`}>
            {Math.round((isPlaying ? effectiveVolume : pad.volume) * 100)}%
          </div>

          {isPlaying && (
            <div className="w-full mt-1">
              <Progress value={progress} className="h-1 rounded-full" />
            </div>
          )}
        </div>
      </Button>

      {showEditDialog && (
        <PadEditDialog
          pad={pad}
          allPads={allPads}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          onSave={handleSave}
          onUnload={handleUnload}
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