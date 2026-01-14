import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { ProgressDialog } from '@/components/ui/progress-dialog';
import { Plus, Settings, Upload, X, Crown, Minus, RotateCcw, Sun, Moon, ChevronUp, ChevronDown, Loader2 } from 'lucide-react';
import { SamplerBank, StopMode, PadData } from './types/sampler';
import { BankEditDialog } from './BankEditDialog';
import { LoginModal } from '@/components/auth/LoginModal';
import { useAuth } from '@/hooks/useAuth';
import { createPortal } from 'react-dom';

type Notice = { id: string; variant: 'success' | 'error' | 'info'; message: string };

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface SideMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  banks: SamplerBank[];
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  isDualMode: boolean;
  padSize: number;
  stopMode: StopMode;
  theme: 'light' | 'dark';
  windowWidth: number;
  editMode: boolean;
  onCreateBank: (name: string, defaultColor: string) => void;
  onSetPrimaryBank: (id: string | null) => void;
  onSetSecondaryBank: (id: string | null) => void;
  onSetCurrentBank: (id: string | null) => void;
  onUpdateBank: (id: string, updates: Partial<SamplerBank>) => void;
  onDeleteBank: (id: string) => void;
  onImportBank: (file: File, onProgress?: (progress: number) => void) => Promise<SamplerBank | null>;
  onExportBank: (id: string, onProgress?: (progress: number) => void) => Promise<void>;
  onPadSizeChange: (size: number) => void;
  onResetPadSize: () => void;
  onStopModeChange: (mode: StopMode) => void;
  onToggleTheme: () => void;
  onMoveBankUp: (id: string) => void;
  onMoveBankDown: (id: string) => void;
  onTransferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  canTransferFromBank?: (bankId: string) => boolean;
  onExportAdmin?: (id: string, title: string, description: string, transferable: boolean, addToDatabase: boolean, allowExport: boolean, onProgress?: (progress: number) => void) => Promise<void>;
}

export function SideMenu({
  open,
  onOpenChange,
  banks,
  primaryBankId,
  secondaryBankId,
  currentBankId,
  isDualMode,
  padSize,
  stopMode,
  theme,
  windowWidth,
  editMode,
  onCreateBank,
  onSetPrimaryBank,
  onSetSecondaryBank,
  onSetCurrentBank,
  onUpdateBank,
  onDeleteBank,
  onImportBank,
  onExportBank,
  onPadSizeChange,
  onResetPadSize,
  onStopModeChange,
  onToggleTheme,
  onMoveBankUp,
  onMoveBankDown,
  onTransferPad,
  canTransferFromBank,
  onExportAdmin
}: SideMenuProps) {
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showEditDialog, setShowEditDialog] = React.useState(false);
  const [editingBank, setEditingBank] = React.useState<SamplerBank | null>(null);
  const [newBankName, setNewBankName] = React.useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [bankToDelete, setBankToDelete] = React.useState<SamplerBank | null>(null);
  const [showLoginModal, setShowLoginModal] = React.useState(false);
  const [pendingImportFile, setPendingImportFile] = React.useState<File | null>(null);
  
  // Progress State
  const [showExportProgress, setShowExportProgress] = React.useState(false);
  const [showImportProgress, setShowImportProgress] = React.useState(false);
  const [exportProgress, setExportProgress] = React.useState(0);
  const [importProgress, setImportProgress] = React.useState(0);
  const [exportStatus, setExportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [importStatus, setImportStatus] = React.useState<'loading' | 'success' | 'error'>('loading');
  const [exportError, setExportError] = React.useState<string>('');
  const [importError, setImportError] = React.useState<string>('');
  const [dragOverBankId, setDragOverBankId] = React.useState<string | null>(null);
  
  // ETA Calculation State
  const [importStartTime, setImportStartTime] = React.useState<number>(0);
  const [importEta, setImportEta] = React.useState<number | null>(null);

  // Loading State
  const [isLoadingBanks, setIsLoadingBanks] = React.useState(true);

  // Toast notification state
  const [notices, setNotices] = React.useState<Notice[]>([]);

  const pushNotice = React.useCallback((n: Omit<Notice, 'id'>) => {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? (crypto as any).randomUUID() : String(Date.now() + Math.random());
    const notice: Notice = { id, ...n };
    setNotices((arr) => [notice, ...arr]);
    setTimeout(() => {
      setNotices((arr) => arr.filter((n) => n.id !== id));
    }, 5000);
  }, []);

  const dismissNotice = React.useCallback((id: string) => {
    setNotices((arr) => arr.filter((n) => n.id !== id));
  }, []);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { user } = useAuth();
  const prevUserIdRef = React.useRef<string | null>(null);

  const isMobile = windowWidth < 768;
  const maxPadSize = isMobile ? 6 : 14;

  // Manage loading state - CHANGED
  // We removed the timeout. It will now keep loading indefinitely until at least one bank is detected.
  React.useEffect(() => {
    if (banks.length > 0) {
      setIsLoadingBanks(false);
    }
  }, [banks]);

  // Sort banks by sortOrder
  const sortedBanks = React.useMemo(() => {
    return [...banks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [banks]);

  const handleCreateBank = () => {
    if (newBankName.trim()) {
      onCreateBank(newBankName.trim(), '#3b82f6');
      setNewBankName('');
      setShowCreateDialog(false);
    }
  };

  const handleEditBank = (bank: SamplerBank) => {
    setEditingBank(bank);
    setShowEditDialog(true);
  };

  const handleDeleteBank = (bank: SamplerBank) => {
    setBankToDelete(bank);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    if (bankToDelete) {
      onDeleteBank(bankToDelete.id);
      setBankToDelete(null);
    }
  };

  const handlePrimaryClick = (bankId: string) => {
    if (bankId === primaryBankId) {
      // Clicking primary again - disable dual mode
      onSetPrimaryBank(null);
    } else {
      // Set as new primary - this enables dual mode
      onSetPrimaryBank(bankId);
    }
  };

  const handleBankClick = (bankId: string) => {
    if (!isDualMode) {
      // In single mode, set as current bank
      onSetCurrentBank(bankId);
    } else if (bankId !== primaryBankId) {
      // In dual mode, set as secondary if it's not primary
      onSetSecondaryBank(bankId);
    }
  };

  // Detect Android/WebView environment
  const isAndroid = React.useMemo(() => /Android/.test(navigator.userAgent), []);
  const isWebView = React.useMemo(() => {
    return !!(window as any).Android || 
           navigator.userAgent.includes('wv') || 
           navigator.userAgent.includes('WebView');
  }, []);

  // Create Android/WebView compatible file input
  const createCompatibleFileInput = React.useCallback((): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bank,application/zip,application/x-zip-compressed';
    input.setAttribute('capture', 'none');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    return input;
  }, []);

  const handleImportClick = React.useCallback(() => {
    // Use enhanced file picker for Android/WebView
    if (isAndroid || isWebView) {
      console.log('📱 Android/WebView detected, using enhanced file picker...');
      const compatibleInput = createCompatibleFileInput();
      
      const handleChange = async (event: Event) => {
        const target = event.target as HTMLInputElement;
        const file = target.files?.[0];
        
        if (file) {
          console.log('✅ File selected:', file.name, file.size, 'bytes');
          await processFileImport(file);
        } else {
          console.warn('⚠️ No file selected');
          pushNotice({ variant: 'error', message: 'No file selected. Please try again.' });
        }
        
        // Clean up
        compatibleInput.removeEventListener('change', handleChange);
        compatibleInput.remove();
      };

      compatibleInput.addEventListener('change', handleChange);
      
      // Add timeout to detect silent failures
      const timeoutId = setTimeout(() => {
        console.warn('⚠️ File picker timeout - no file selected within 5 seconds');
        pushNotice({ 
          variant: 'error', 
          message: 'File picker did not respond. Please try selecting the file again or use Google Drive to import.' 
        });
        compatibleInput.removeEventListener('change', handleChange);
        compatibleInput.remove();
      }, 5000);

      compatibleInput.addEventListener('change', () => clearTimeout(timeoutId), { once: true });

      try {
        compatibleInput.click();
        console.log('📱 Enhanced file picker triggered');
      } catch (error) {
        console.error('❌ Failed to trigger file picker:', error);
        pushNotice({ 
          variant: 'error', 
          message: 'Failed to open file picker. Please try again or use Google Drive to import.' 
        });
        clearTimeout(timeoutId);
      }
    } else {
      // Standard file input for other platforms
      fileInputRef.current?.click();
    }
  }, [isAndroid, isWebView, createCompatibleFileInput, pushNotice]);

  const processFileImport = React.useCallback(async (file: File) => {
    // Validate file
    if (!file) {
      pushNotice({ variant: 'error', message: 'No file selected.' });
      return;
    }

    if (!file.name.endsWith('.bank')) {
      pushNotice({ variant: 'error', message: 'Invalid file type. Please select a .bank file.' });
      return;
    }

    if (file.size === 0) {
      pushNotice({ variant: 'error', message: 'Selected file is empty.' });
      return;
    }

    console.log('📦 Starting import process for:', file.name, `(${(file.size / 1024).toFixed(1)}KB)`);

    setShowImportProgress(true);
    setImportStatus('loading');
    setImportProgress(0);
    setImportError('');
    
    // Reset ETA calculation
    setImportStartTime(Date.now());
    setImportEta(null);

    try {
      await onImportBank(file, (progress) => {
        setImportProgress(progress);
      });
      setImportStatus('success');
      pushNotice({ variant: 'success', message: 'Bank imported successfully!' });
      setPendingImportFile(null); // Clear pending file on success
    } catch (error) {
      console.error('❌ Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      setImportStatus('error');
      setImportError(errorMessage);
      
      // Check if error is login-related
      const needsLogin = errorMessage.toLowerCase().includes('sign in') || 
                        errorMessage.toLowerCase().includes('login required') ||
                        errorMessage.toLowerCase().includes('please sign in');
      
      if (needsLogin) {
        // Store file for auto-import after login
        setPendingImportFile(file);
      } else {
        setPendingImportFile(null);
      }
      
      pushNotice({ variant: 'error', message: `Import failed: ${errorMessage}` });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onImportBank, pushNotice]);

  const handleFileSelect = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await processFileImport(file);
    }
  }, [processFileImport]);

  // Auto-import pending file after login (moved here after processFileImport is defined)
  React.useEffect(() => {
    const currentUserId = user?.id || null;
    const justLoggedIn = currentUserId && prevUserIdRef.current !== currentUserId;
    
    if (justLoggedIn && pendingImportFile) {
      prevUserIdRef.current = currentUserId;
      // Close login modal
      setShowLoginModal(false);
      
      // Small delay to ensure login state is fully propagated
      setTimeout(() => {
        // Auto-import the pending file
        processFileImport(pendingImportFile).finally(() => {
          setPendingImportFile(null);
        });
      }, 100);
    } else {
      prevUserIdRef.current = currentUserId;
    }
  }, [user, pendingImportFile, processFileImport]);

  // ETA Calculation Effect
  React.useEffect(() => {
    let interval: NodeJS.Timeout;

    if (showImportProgress && importStatus === 'loading' && importProgress > 0 && importProgress < 100) {
      
      const calculateEta = () => {
        const now = Date.now();
        const elapsedSeconds = (now - importStartTime) / 1000;
        
        // Rate = percent per second
        const rate = importProgress / elapsedSeconds;
        
        if (rate > 0) {
          const remainingPercent = 100 - importProgress;
          let estimatedSeconds = remainingPercent / rate;

          // "Smart Floor" Logic
          if (estimatedSeconds < 3 && importProgress < 98) {
             estimatedSeconds = 5; 
          }

          setImportEta(estimatedSeconds);
        }
      };

      // Run calculation immediately
      calculateEta();
      // Recalculate every 1 second
      interval = setInterval(calculateEta, 1000);

    } else if (importStatus !== 'loading') {
      setImportEta(null);
    }

    return () => clearInterval(interval);
  }, [importProgress, showImportProgress, importStatus, importStartTime]);

  const getImportPhaseInfo = () => {
    if (importProgress < 20) {
      return {
        message: "Verifying your purchase...",
        showWarning: true
      };
    }
    return {
      message: "Extracting and processing audio files and images...",
      showWarning: false
    };
  };

  const importPhase = getImportPhaseInfo();

  const handleExportBank = async (bankId: string) => {
    setShowExportProgress(true);
    setExportStatus('loading');
    setExportProgress(0);
    setExportError('');

    try {
      await onExportBank(bankId, (progress) => {
        setExportProgress(progress);
      });
      setExportStatus('success');
    } catch (error) {
      console.error('Export failed:', error);
      setExportStatus('error');
      setExportError(error instanceof Error ? error.message : 'Export failed');
    }
  };

  const handlePadSizeIncrease = React.useCallback(() => {
    let newSize = padSize + 1;
    if (isDualMode && newSize % 2 !== 0 && newSize < maxPadSize) {
      newSize = newSize + 1;
    }
    if (newSize <= maxPadSize) {
      onPadSizeChange(newSize);
    }
  }, [padSize, maxPadSize, onPadSizeChange, isDualMode]);

  const handlePadSizeDecrease = React.useCallback(() => {
    let newSize = padSize - 1;
    if (isDualMode && newSize % 2 !== 0 && newSize > 1) {
      newSize = newSize - 1;
    }
    if (newSize >= 1) {
      onPadSizeChange(newSize);
    }
  }, [padSize, onPadSizeChange, isDualMode]);

  const handleBankDragOver = (e: React.DragEvent, bankId: string) => {
    if (!editMode) return;

    e.preventDefault();
    e.stopPropagation();

    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (!data) return;

    try {
      const dragData = JSON.parse(data);
      console.log('Drag over bank:', bankId, 'with data:', dragData);

      if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== bankId) {
        if (canTransferFrom(dragData.sourceBankId)) {
          setDragOverBankId(bankId);
        }
      }
    } catch (error) {
      console.warn('Invalid drag data format:', error);
    }
  };

  const handleBankDrop = (e: React.DragEvent, targetBankId: string) => {
    if (!editMode) return;

    e.preventDefault();
    e.stopPropagation();
    setDragOverBankId(null);

    let data = e.dataTransfer.getData('application/json');
    if (!data) {
      data = e.dataTransfer.getData('text/plain');
    }

    if (!data) {
      console.warn('No drag data found');
      return;
    }

    try {
      const dragData = JSON.parse(data);
      console.log('Drop on bank:', targetBankId, 'with data:', dragData);

      if (dragData.type === 'pad-transfer' && dragData.sourceBankId !== targetBankId) {
        if (canTransferFrom(dragData.sourceBankId)) {
          console.log('Executing pad transfer:', dragData.pad.id, 'from', dragData.sourceBankId, 'to', targetBankId);
          onTransferPad(dragData.pad.id, dragData.sourceBankId, targetBankId);
        }
      }
    } catch (error) {
      console.error('Error processing pad drop:', error);
    }
  };

  const handleBankDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverBankId(null);
    }
  };

  const getBankStatus = (bankId: string) => {
    if (bankId === primaryBankId) return 'primary';
    if (bankId === secondaryBankId) return 'secondary';
    if (bankId === currentBankId) return 'current';
    return 'inactive';
  };

  const canMoveUp = (bankIndex: number) => bankIndex > 0;
  const canMoveDown = (bankIndex: number) => bankIndex < sortedBanks.length - 1;

  const getTextColorForBackground = (backgroundColor: string) => {
    const hex = backgroundColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  };

  const canAcceptDrop = (bankId: string) => true;

  const canTransferFrom = (bankId: string) => {
    return canTransferFromBank ? canTransferFromBank(bankId) : true;
  };

  return (
    <>
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 border-r transition-all duration-200 ${theme === 'dark'
          ? 'bg-gray-800 border-gray-700'
          : 'bg-white border-gray-200'
          } ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div
          className={`flex items-center justify-between p-2 border-b ${theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
            }`}
        >
          <div className="space-y-2">
            <Button
              onClick={onToggleTheme}
              variant="outline"
              size="sm"
              className={`w-full ${theme === 'dark'
                ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                }`}
            >
              {theme === 'dark' ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
            </Button>
          </div>

          <h2
            className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-gray-900'
              }`}
          >
            Banks
          </h2>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className={
              theme === 'dark'
                ? 'text-gray-400 hover:text-white'
                : 'text-gray-600 hover:text-gray-900'
            }
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-2 max-h-[calc(100vh-80px)] overflow-y-auto">
          <div className="grid grid-cols-2 gap-2 mb-1">
            <div className="space-y-2">
              <Label
                className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}
              >
                Pad Size
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  onClick={handlePadSizeDecrease}
                  disabled={padSize <= (isDualMode ? 2 : 1)}
                  variant="outline"
                  size="sm"
                  className={`w-10 h-10 p-0 ${theme === 'dark'
                    ? 'bg-gray-700 border-gray-600'
                    : 'bg-white border-gray-300'
                    }`}
                >
                  <Minus className="w-3 h-3" />
                </Button>
                <span
                  className={`flex-1 text-center text-xs ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'
                    }`}
                >
                  {padSize}/{maxPadSize}
                </span>
                <Button
                  onClick={handlePadSizeIncrease}
                  disabled={padSize >= maxPadSize}
                  variant="outline"
                  size="sm"
                  className={`w-10 h-10 p-0 ${theme === 'dark'
                    ? 'bg-gray-700 border-gray-600'
                    : 'bg-white border-gray-300'
                    }`}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label
                className={`font-medium ${theme === 'dark' ? 'text-white' : 'text-gray-900'
                  }`}
              >
                Stop Mode
              </Label>
              <Select
                value={stopMode}
                onValueChange={(value: StopMode) => onStopModeChange(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instant">Instant Stop</SelectItem>
                  <SelectItem value="fadeout">Fade Out</SelectItem>
                  <SelectItem value="brake">Brake</SelectItem>
                  <SelectItem value="backspin">Backspin</SelectItem>
                  <SelectItem value="filter">Filter Sweep</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-1">
            <div className="flex mb-2">
              <Button
                onClick={() => setShowCreateDialog(true)}
                className={`flex-1 gap-0 transition-all duration-200 ${theme === 'dark'
                  ? 'bg-blue-500 border-blue-400 text-blue-400 hover:bg-blue-600'
                  : 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100'
                  }`}
              >
                <Plus className="w-4 h-4 mr-2" />
                New Bank
              </Button>
            </div>

            <div className="flex mb-2">
              <Button
                onClick={handleImportClick}
                variant="outline"
                className={`flex-1 transition-all duration-200 ${theme === 'dark'
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
              >
                <Upload className="w-4 h-4 mr-2" />
                Import
              </Button>
            </div>
          </div>

          {editMode && (
            <div className={`mb-1 p-2 rounded-lg border ${theme === 'dark'
              ? 'bg-orange-900 border-orange-600 text-orange-300'
              : 'bg-orange-50 border-orange-300 text-orange-700'
              }`}>
              <p className="text-xs text-center font-medium">
                🎯 Drag sampler to your bank
              </p>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept=".bank,application/zip,application/x-zip-compressed"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="space-y-2">
            {isLoadingBanks && sortedBanks.length === 0 ? (
              <div className={`flex flex-col gap-2 p-8 items-center justify-center ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'
                }`}>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm">Loading banks...</span>
              </div>
            ) : sortedBanks.map((bank, index) => {
              const status = getBankStatus(bank.id);
              const isPrimary = status === 'primary';
              const isSecondary = status === 'secondary';
              const isCurrent = status === 'current';
              const isActive = isPrimary || isSecondary || isCurrent;
              const isDragOver = dragOverBankId === bank.id;

              return (
                <div
                  key={bank.id}
                  className={`p-2 rounded-lg border-2 transition-all duration-200 relative ${isDragOver
                    ? 'ring-4 ring-orange-400 scale-105 bg-orange-200'
                    : ''
                    } ${isActive
                      ? isPrimary
                        ? theme === 'dark'
                          ? 'bg-gray-700 border-blue-400 text-white'
                          : 'bg-white border-blue-400 text-gray-900'
                        : isSecondary
                          ? theme === 'dark'
                            ? 'bg-gray-700 border-purple-400 text-white'
                            : 'bg-white border-purple-400 text-gray-900'
                          : theme === 'dark'
                            ? 'bg-gray-700 border-green-400 text-white'
                            : 'bg-white border-green-400 text-gray-900'
                      : theme === 'dark'
                        ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600 cursor-pointer'
                        : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'
                    }`}
                  style={!isActive ? { backgroundColor: bank.defaultColor, borderColor: bank.defaultColor } : undefined}
                  onDragOver={(e) => handleBankDragOver(e, bank.id)}
                  onDrop={(e) => handleBankDrop(e, bank.id)}
                  onDragLeave={handleBankDragLeave}
                >
                  {/* Drop zone indicator for edit mode */}
                  {editMode && isDragOver && canAcceptDrop(bank.id) && (
                    <div className={`absolute inset-0 border-4 border-dashed border-orange-400 rounded-xl flex items-center justify-center z-10 ${theme === 'dark'
                      ? 'bg-orange-900 text-orange-200'
                      : 'bg-orange-50 text-orange-800'
                      }`}>
                      <div className="text-center">
                        <div className="text-2xl mb-1">🎯</div>
                        <p className="font-bold text-sm">DROP PAD HERE</p>
                        <p className="text-xs opacity-75">Transfer to {bank.name}</p>
                        {isActive && (
                          <p className="text-xs opacity-60 mt-1">
                            {isPrimary ? '(Primary Bank)' : isSecondary ? '(Secondary Bank)' : '(Current Bank)'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between mb-1">
                    <div className="flex-1 cursor-pointer" onClick={() => handleBankClick(bank.id)}>
                      <h3 className="font-medium text-sm truncate" title={bank.name} style={!isActive ? { color: getTextColorForBackground(bank.defaultColor) } : undefined}>
                        {bank.name.length > 15 ? `${bank.name.substring(0, 15)}...` : bank.name}
                      </h3>
                      <p className="text-xs opacity-75" style={!isActive ? { color: getTextColorForBackground(bank.defaultColor) } : undefined}>
                        {bank.pads.length} pad{bank.pads.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="flex flex-col gap-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveBankUp(bank.id);
                          }}
                          disabled={!canMoveUp(index)}
                          className={`p-0 h-3 w-4 transition-all duration-200 ${theme === 'dark'
                            ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                            }`}
                          title="Move up"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onMoveBankDown(bank.id);
                          }}
                          disabled={!canMoveDown(index)}
                          className={`p-0 h-3 w-4 transition-all duration-200 ${theme === 'dark'
                            ? 'text-gray-400 hover:text-white hover:bg-gray-600 disabled:text-gray-600'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-white disabled:text-gray-400'
                            }`}
                          title="Move down"
                        >
                          <ChevronDown className="w-3 h-3" />
                        </Button>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrimaryClick(bank.id);
                        }}
                        disabled={bank.id === secondaryBankId}
                        className={`p-1 h-6 w-6 transition-all duration-200 ${isPrimary
                          ? theme === 'dark'
                            ? 'bg-yellow-500 text-yellow-300 hover:bg-yellow-400'
                            : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                          : theme === 'dark'
                            ? 'text-gray-400 hover:text-yellow-300 hover:bg-yellow-500'
                            : 'text-gray-600 hover:text-yellow-700 hover:bg-yellow-100'
                          }`}
                        title={isPrimary ? 'Primary (click to exit dual mode)' : 'Set as Primary'}
                      >
                        <Crown className="w-3 h-3" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditBank(bank);
                        }}
                        className={`p-1 h-6 w-6 transition-all duration-200 ${theme === 'dark'
                          ? 'text-gray-400 hover:text-white hover:bg-gray-600'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-white'
                          }`}
                      >
                        <Settings className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className={`${theme === 'dark' ? 'bg-gray-800' : 'bg-white'
          }`} aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Create New Bank</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div>
              <Label htmlFor="bankName">Bank Name</Label>
              <Input
                id="bankName"
                value={newBankName}
                onChange={(e) => {
                  if (e.target.value.length <= 18) {
                    setNewBankName(e.target.value);
                  }
                }}
                placeholder="Enter bank name"
                onKeyPress={(e) => e.key === 'Enter' && handleCreateBank()}
                maxLength={24}
              />
            </div>
            <div className="flex gap-1">
              <Button onClick={handleCreateBank} className="flex-1">
                Create Bank
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowCreateDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {editingBank && (
        <BankEditDialog
          bank={editingBank}
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          theme={theme}
          onSave={(updates) => {
            onUpdateBank(editingBank.id, updates);
            setShowEditDialog(false);
          }}
          onDelete={() => {
            setShowEditDialog(false);
            handleDeleteBank(editingBank);
          }}
          onExport={() => {
            setShowEditDialog(false);
            handleExportBank(editingBank.id);
          }}
          onExportAdmin={onExportAdmin}
        />
      )}

      <ConfirmationDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Bank"
        description={`Are you sure you want to delete the bank "${bankToDelete?.name}"? This will permanently delete all pads in this bank. This action cannot be undone.`}
        confirmText="Delete Bank"
        variant="destructive"
        onConfirm={handleConfirmDelete}
        theme={theme}
      />

      <ProgressDialog
        open={showExportProgress}
        onOpenChange={setShowExportProgress}
        title="Exporting Bank"
        description="Compressing audio files, images, and bank data..."
        progress={exportProgress}
        status={exportStatus}
        type="export"
        theme={theme}
        errorMessage={exportError}
        onRetry={() => {
          if (banks.length > 0) {
            handleExportBank(banks[0].id);
          }
        }}
      />

      <ProgressDialog
        open={showImportProgress}
        onOpenChange={setShowImportProgress}
        title="Importing Bank"
        description=""
        progress={importProgress}
        status={importStatus}
        type="import"
        theme={theme}
        errorMessage={importError}
        statusMessage={importPhase.message}
        etaSeconds={importEta}
        showWarning={importPhase.showWarning}
        onRetry={() => {
          handleImportClick();
        }}
        onLogin={() => {
          // File is already stored in pendingImportFile when error occurred
          setShowLoginModal(true);
        }}
      />

      {/* Toast Notifications */}
      {typeof document !== 'undefined' && createPortal(
        <div className="fixed top-0 left-0 right-0 z-[2147483647] flex justify-center pointer-events-none">
          <div className="w-full max-w-xl px-3">
            {notices.map((notice) => (
              <NoticeItem key={notice.id} notice={notice} dismiss={dismissNotice} theme={theme} />
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* Login Modal */}
      <LoginModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
        theme={theme}
        pushNotice={pushNotice}
      />
    </>
  );
}

// Toast notification component
function NoticeItem({ notice, dismiss, theme }: { notice: Notice; dismiss: (id: string) => void; theme: 'light' | 'dark' }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShow(true), 10);
    return () => clearTimeout(t);
  }, []);

  const base = 'pointer-events-auto mt-3 rounded-lg border px-4 py-2 shadow-lg transition-all duration-300';
  const colors =
    notice.variant === 'success'
      ? (theme === 'dark' ? 'bg-green-600/90 border-green-500 text-white' : 'bg-green-600 text-white border-green-700')
      : notice.variant === 'error'
        ? (theme === 'dark' ? 'bg-red-600/90 border-red-500 text-white' : 'bg-red-600 text-white border-red-700')
        : (theme === 'dark' ? 'bg-gray-800/90 border-gray-700 text-white' : 'bg-gray-900 text-white border-gray-800');

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
  );
}