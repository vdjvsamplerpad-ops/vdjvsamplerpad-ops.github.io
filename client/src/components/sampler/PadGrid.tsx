import * as React from 'react';
import { SamplerPad } from './SamplerPad';
import { PadData, StopMode } from './types/sampler';

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface PadGridProps {
  pads: PadData[];
  bankId: string;
  bankName: string;
  allPads: PadData[];
  editMode: boolean;
  globalMuted: boolean;
  masterVolume: number;
  padSize: number;
  theme: 'light' | 'dark';
  stopMode: StopMode;
  eqSettings: EqSettings;
  windowWidth: number;
  onUpdatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  onRemovePad: (id: string) => void;
  onReorderPads: (fromIndex: number, toIndex: number) => void;
  onFileUpload?: (file: File) => void;
  onPadDragStart?: (e: React.DragEvent, pad: PadData, bankId: string) => void;
  onTransferPad?: (padId: string, sourceBankId: string, targetBankId: string) => void;
  availableBanks?: Array<{ id: string; name: string; }>;
  canTransferFromBank?: (bankId: string) => boolean;
}

export function PadGrid({
  pads,
  bankId,
  bankName,
  allPads,
  editMode,
  globalMuted,
  masterVolume,
  padSize,
  theme,
  stopMode,
  eqSettings,
  windowWidth,
  onUpdatePad,
  onRemovePad,
  onReorderPads,
  onFileUpload,
  onPadDragStart,
  onTransferPad,
  availableBanks = [],
  canTransferFromBank
}: PadGridProps) {
  const [draggedIndex, setDraggedIndex] = React.useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = React.useState<number | null>(null);
  const [isDragOverGrid, setIsDragOverGrid] = React.useState(false);
  const [dragOverPadTransfer, setDragOverPadTransfer] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Handle drag and drop for file uploads
  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverGrid(false);
    setDragOverPadTransfer(false);

    // Check if this is a pad transfer
    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (data) {
      try {
        const dragData = JSON.parse(data);
        if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId && onTransferPad) {
          // Check if source bank allows transfers
          if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
            console.log('Grid handling pad transfer:', dragData.pad.id, 'from', dragData.sourceBankId, 'to', bankId);
            onTransferPad(dragData.pad.id, dragData.sourceBankId, bankId);
          }
          return;
        }
      } catch (error) {
        console.warn('Failed to parse drag data:', error);
      }
    }

    // Handle file uploads
    if (!onFileUpload) return;

    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));

    audioFiles.forEach(file => {
      onFileUpload(file);
    });
  }, [onFileUpload, onTransferPad, bankId]);

  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    e.preventDefault();

    // Check if this is a pad transfer from another bank
    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (data) {
      try {
        const dragData = JSON.parse(data);
        if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId) {
          // Check if source bank allows transfers
          if (!canTransferFromBank || canTransferFromBank(dragData.sourceBankId)) {
            setDragOverPadTransfer(true);
            setIsDragOverGrid(false);
          }
          return;
        }
      } catch (error) {
        // Not a pad transfer, continue with file drag
      }
    }

    // Regular file drag over
    setIsDragOverGrid(true);
    setDragOverPadTransfer(false);
  }, [bankId]);

  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear if actually leaving the grid
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOverGrid(false);
      setDragOverPadTransfer(false);
    }
  }, []);

  const handleFileSelect = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0 && onFileUpload) {
      Array.from(files).forEach(file => {
        if (file.type.startsWith('audio/')) {
          onFileUpload(file);
        }
      });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onFileUpload]);

  const handleEmptyAreaClick = () => {
    if (onFileUpload) {
      fileInputRef.current?.click();
    }
  };

  const handlePadDragStartFromPad = (e: React.DragEvent, pad: PadData, sourceBankId: string) => {
    console.log('Pad drag start from grid:', pad.id, sourceBankId);
    if (onPadDragStart) {
      onPadDragStart(e, pad, sourceBankId);
    }
  };

  if (pads.length === 0) {
    return (
      <>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />
        <div
          className={`flex items-center justify-center h-64 rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer relative ${dragOverPadTransfer
              ? 'border-orange-400 bg-orange-100 scale-105'
              : isDragOverGrid
                ? 'border-blue-400 bg-blue-50'
                : theme === 'dark'
                  ? 'bg-gray-800 border-gray-600 hover:bg-gray-700'
                  : 'bg-white border-gray-300 hover:bg-gray-50'
            }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={!dragOverPadTransfer ? handleEmptyAreaClick : undefined}
        >
          {dragOverPadTransfer ? (
            <div className="text-center">
              <div className="text-4xl mb-2">🎯</div>
              <p className="text-lg font-bold text-orange-700">DROP PAD HERE</p>
              <p className="text-sm text-orange-600">Transfer to {bankName}</p>
            </div>
          ) : (
            <div className="text-center">
              <p className={`text-lg mb-2 ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>
                No pads loaded
              </p>
              <p className={`text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-600'}`}>
                Click here or drag audio files to create pads
              </p>
            </div>
          )}
        </div>
      </>
    );
  }

  // Sort pads by position for consistent ordering
  const sortedPads = [...pads].sort((a, b) => (a.position || 0) - (b.position || 0));

  // Calculate responsive gap and sizing
  const isMobile = windowWidth < 768;
  const gap = isMobile ? 'gap-0' : 'gap-1';
  const aspectRatio = 'aspect-square';

  const handlePadDragStart = (e: React.DragEvent, index: number) => {
    if (!editMode) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handlePadDragOver = (e: React.DragEvent, index: number) => {
    if (!editMode || draggedIndex === null) return;
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handlePadDragEnd = () => {
    if (!editMode) return;
    if (draggedIndex !== null && dragOverIndex !== null && draggedIndex !== dragOverIndex) {
      onReorderPads(draggedIndex, dragOverIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handlePadDragLeave = () => {
    setDragOverIndex(null);
  };

  return (
    <div
      className={`grid ${gap} w-full transition-all duration-200 ${dragOverPadTransfer
          ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-transparent bg-orange-50 dark:bg-orange-900/20 rounded-2xl p-2'
          : ''
        }`}
      style={{
        gridTemplateColumns: `repeat(${padSize}, minmax(0, 1fr))`,
      }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Drop zone indicator overlay for pad transfers */}
      {dragOverPadTransfer && (
        <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
          <div className={`text-center p-4 rounded-xl ${theme === 'dark'
              ? 'bg-orange-900/80 text-orange-200 border border-orange-600'
              : 'bg-orange-100/90 text-orange-800 border border-orange-400'
            }`}>
            <div className="text-3xl mb-2">🎯</div>
            <p className="font-bold text-lg">DROP PAD HERE</p>
            <p className="text-sm opacity-75">Transfer to {bankName}</p>
          </div>
        </div>
      )}

      {sortedPads.map((pad, index) => (
        <div
          key={pad.id}
          className={`${aspectRatio} ${editMode && dragOverIndex === index ? 'ring-2 ring-blue-400' : ''
            }`}
          draggable={editMode}
          onDragStart={(e) => handlePadDragStart(e, index)}
          onDragOver={(e) => handlePadDragOver(e, index)}
          onDragEnd={handlePadDragEnd}
          onDragLeave={handlePadDragLeave}
        >
          <SamplerPad
            pad={pad}
            bankId={bankId}
            bankName={bankName}
            allPads={allPads}
            editMode={editMode}
            globalMuted={globalMuted}
            masterVolume={masterVolume}
            theme={theme}
            stopMode={stopMode}
            eqSettings={eqSettings}
            padSize={padSize}
            onUpdatePad={onUpdatePad}
            onRemovePad={onRemovePad}
            onDragStart={handlePadDragStartFromPad}
            onTransferPad={onTransferPad}
            availableBanks={availableBanks}
            canTransferFromBank={canTransferFromBank}
          />
        </div>
      ))}
    </div>
  );
}
