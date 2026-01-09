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
}

const defaultSettings: AppSettings = {
  masterVolume: 1,
  eqSettings: { low: 0, mid: 0, high: 0 },
  stopMode: 'fadeout',
  sideMenuOpen: false,
  mixerOpen: false,
  editMode: false,
  padSize: 4
};

export function SamplerPadApp() {
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

  const playbackManager = useGlobalPlaybackManager();
  const { theme, toggleTheme } = useTheme();
  const { width: windowWidth } = useWindowSize();

  // Load settings from localStorage
  const [settings, setSettings] = React.useState<AppSettings>(() => {
    if (typeof window === 'undefined') return defaultSettings;

    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) };
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

  // Update individual settings
  const updateSetting = React.useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Get playing pads from global manager
  const playingPads = playbackManager.getAllPlayingPads();

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

      await addPad(file, targetBankId);
    } catch (error) {
      console.error('Error uploading file:', error);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError('Failed to upload file. Please try again.');
      }
      setShowErrorDialog(true);
    }
  }, [addPad]);

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

  return (
    <div className={`min-h-screen transition-all duration-300 ${theme === 'dark'
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
      />

      {VolumeMixer && (
        <VolumeMixer
          open={settings.mixerOpen}
          onOpenChange={handleMixerToggle}
          playingPads={playingPads}
          masterVolume={settings.masterVolume}
          onMasterVolumeChange={(volume) => updateSetting('masterVolume', volume)}
          onPadVolumeChange={handlePadVolumeChange}
          onStopPad={handleStopSpecificPad}
          eqSettings={settings.eqSettings}
          onEqChange={(eq) => updateSetting('eqSettings', eq)}
          theme={theme}
          windowWidth={windowWidth}
        />
      )}

      <div className={`flex-1 transition-all duration-300 ${getMainContentMargin} ${getMainContentPadding}`}>
        <div className="max-w-full mx-auto py-2 relative z-10">
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
          />

          {isDualMode ? (
            <div className="flex gap-2">
              {/* Primary Bank */}
              <div className="flex-1">

                <PadGrid
                  pads={displayPrimary?.pads || []}
                  bankId={primaryBankId || ''}
                  bankName={displayPrimary?.name || ''}
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
                />
              </div>

              {/* Secondary Bank */}
              <div className="flex-1">
                {displaySecondary ? (
                  <PadGrid
                    pads={displaySecondary.pads || []}
                    bankId={secondaryBankId || ''}
                    bankName={displaySecondary.name || ''}
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
                  />
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
