import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Upload, Music, AlertCircle, Smartphone } from 'lucide-react';

// IndexedDB setup
const DB_NAME = 'sampler-audio-db';
const STORE_NAME = 'audio-files';

// Enhanced iOS-compatible audio formats
const SUPPORTED_AUDIO_FORMATS = [
  'audio/mpeg',           // MP3
  'audio/mp3',           // MP3 (alternative MIME)
  'audio/wav',           // WAV
  'audio/wave',          // WAV (alternative)
  'audio/x-wav',         // WAV (alternative)
  'audio/aac',           // AAC
  'audio/mp4',           // M4A
  'audio/x-m4a',         // M4A (alternative)
  'audio/ogg',           // OGG
  'audio/webm',          // WebM
  'audio/m4a',           // M4A (alternative)
  'audio/aiff',          // AIFF
  'audio/x-aiff',        // AIFF (alternative)
  'audio/flac',          // FLAC
  'audio/x-flac',        // FLAC (alternative)
  // iOS Safari specific
  'audio/x-m4a',         // iOS M4A
  'audio/m4a',           // iOS M4A
  'audio/aac',           // iOS AAC
  'audio/mp3',           // iOS MP3
];

// File extensions for iOS compatibility
const SUPPORTED_EXTENSIONS = [
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.aiff', '.flac'
];

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFile(file: File) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(file);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAllFiles(): Promise<File[]> {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result as File[]);
    req.onerror = () => resolve([]);
  });
}

// Enhanced iOS-compatible file validation
function isValidAudioFile(file: File): boolean {
  // Check MIME type
  if (SUPPORTED_AUDIO_FORMATS.includes(file.type)) {
    return true;
  }
  
  // Check file extension (for iOS compatibility)
  const fileName = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext));
}

// Enhanced iOS-compatible file input setup
function createIOSCompatibleFileInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  
  // Enhanced iOS Safari compatible accept string
  const acceptTypes = [
    'audio/*',
    '.mp3,.wav,.m4a,.aac,.ogg,.webm,.aiff,.flac',
    'audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/aac,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/m4a,audio/aiff,audio/x-aiff,audio/flac,audio/x-flac'
  ].join(',');
  
  input.accept = acceptTypes;
  
  // iOS Safari specific attributes
  input.setAttribute('capture', 'none'); // Don't use camera/microphone
  input.setAttribute('webkitdirectory', 'false');
  input.setAttribute('data-ios', 'true');
  
  // Additional iOS attributes
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  
  return input;
}

interface FileUploaderProps {
  onFilesUpload: (files: File[]) => void;
  onError?: (error: string) => void;
}

export function FileUploader({ onFilesUpload, onError }: FileUploaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [isIOS, setIsIOS] = React.useState(false);
  const [showIOSHelp, setShowIOSHelp] = React.useState(false);

  // Detect iOS
  React.useEffect(() => {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);
  }, []);

  // Load all stored files on mount
  React.useEffect(() => {
    (async () => {
      try {
        const storedFiles = await loadAllFiles();
        if (storedFiles.length > 0) {
          onFilesUpload(storedFiles);
        }
      } catch (error) {
        console.error('Failed to load stored files:', error);
        onError?.('Failed to load stored audio files');
      }
    })();
  }, [onFilesUpload, onError]);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${file.size}`);
        
        if (isValidAudioFile(file)) {
          validFiles.push(file);
          console.log(`✅ Valid audio file: ${file.name}`);
        } else {
          invalidFiles.push(file.name);
          console.log(`❌ Invalid file: ${file.name} (type: ${file.type})`);
        }
        
        // Update progress
        setUploadProgress(((i + 1) / files.length) * 100);
      }

      // Save valid files
      for (const file of validFiles) {
        await saveFile(file);
      }

      // Load all stored files and notify
      const storedFiles = await loadAllFiles();
      onFilesUpload(storedFiles);

      // Show results
      if (validFiles.length > 0) {
        console.log(`✅ Successfully uploaded ${validFiles.length} audio files`);
      }
      
      if (invalidFiles.length > 0) {
        const errorMsg = `❌ Unsupported file types: ${invalidFiles.join(', ')}`;
        console.warn(errorMsg);
        onError?.(errorMsg);
      }

    } catch (error) {
      console.error('Upload failed:', error);
      onError?.('Failed to upload audio files');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerFileSelect = () => {
    if (isIOS) {
      console.log('🍎 iOS detected, using enhanced file picker...');
      
      // Use iOS-compatible file input
      const iosInput = createIOSCompatibleFileInput();
      
      // Add event listener
      iosInput.addEventListener('change', (event) => {
        console.log('iOS file input change event triggered');
        handleFileSelect(event as any);
      });
      
      // Add error handling
      iosInput.addEventListener('error', (event) => {
        console.error('iOS file input error:', event);
        onError?.('Failed to open file picker on iOS');
      });
      
      // Trigger file picker
      try {
        iosInput.click();
        console.log('iOS file picker triggered');
      } catch (error) {
        console.error('Failed to trigger iOS file picker:', error);
        onError?.('Failed to open file picker. Please try again.');
      }
    } else {
      // Use regular file input
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    try {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (isValidAudioFile(file)) {
          validFiles.push(file);
        } else {
          invalidFiles.push(file.name);
        }
        
        setUploadProgress(((i + 1) / files.length) * 100);
      }

      for (const file of validFiles) {
        await saveFile(file);
      }

      const storedFiles = await loadAllFiles();
      onFilesUpload(storedFiles);

      if (invalidFiles.length > 0) {
        onError?.(`Unsupported file types: ${invalidFiles.join(', ')}`);
      }

    } catch (error) {
      console.error('Drop upload failed:', error);
      onError?.('Failed to upload audio files');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="text-center space-y-4">
      {/* Hidden file input for non-iOS */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm,.aiff,.flac"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {/* Drag & Drop Zone */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 transition-colors
          ${isUploading 
            ? 'border-blue-400 bg-blue-50' 
            : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
          }
        `}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="flex flex-col items-center space-y-4">
          <Music className="w-12 h-12 text-gray-400" />
          
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900">
              {isUploading ? 'Uploading Audio Files...' : 'Upload Audio Files'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Drag and drop audio files here, or click to browse
            </p>
          </div>

          {/* Progress Bar */}
          {isUploading && (
            <div className="w-full max-w-xs">
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {Math.round(uploadProgress)}% complete
              </p>
            </div>
          )}

          {/* Upload Button */}
          <Button
            onClick={triggerFileSelect}
            disabled={isUploading}
            className="bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            <Upload className="w-4 h-4 mr-2" />
            {isUploading ? 'Uploading...' : 'Select Audio Files'}
          </Button>
        </div>
      </div>

      {/* iOS Notice */}
      {isIOS && (
        <div className="space-y-3">
          <div className="flex items-center justify-center space-x-2 text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
            <Smartphone className="w-4 h-4" />
            <span>
              iOS detected: Tap "Select Audio Files" to choose from your device
            </span>
          </div>
          
          <div className="text-xs text-gray-600 bg-gray-50 p-3 rounded-lg">
            <p className="font-medium mb-2">iOS Audio Upload Tips:</p>
            <ul className="text-left space-y-1">
              <li>• Make sure your audio files are in your device's Files app</li>
              <li>• Supported formats: MP3, WAV, M4A, AAC, OGG, WebM, AIFF, FLAC</li>
              <li>• If files don't appear, try importing them to Files app first</li>
              <li>• Some files may need to be downloaded from cloud storage</li>
            </ul>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowIOSHelp(!showIOSHelp)}
            className="text-xs"
          >
            {showIOSHelp ? 'Hide' : 'Show'} iOS Help
          </Button>
          
          {showIOSHelp && (
            <div className="text-xs text-gray-600 bg-blue-50 p-3 rounded-lg text-left">
              <p className="font-medium mb-2">How to add audio files on iOS:</p>
              <ol className="space-y-1 list-decimal list-inside">
                <li>Download audio files to your device</li>
                <li>Open the Files app and locate your audio files</li>
                <li>Tap "Select Audio Files" in this app</li>
                <li>Choose "Browse" or "Files" when prompted</li>
                <li>Navigate to your audio files and select them</li>
                <li>Tap "Done" to upload them</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Supported Formats */}
      <div className="text-xs text-gray-500">
        <p className="font-medium mb-1">Supported Audio Formats:</p>
        <p>MP3, WAV, M4A, AAC, OGG, WebM, AIFF, FLAC</p>
      </div>
    </div>
  );
}
