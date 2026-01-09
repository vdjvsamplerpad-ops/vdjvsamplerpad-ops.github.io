import React from 'react';
import { Smartphone, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { useTheme } from './hooks/useTheme';

interface IOSFilePickerProps {
  onFilesSelected: (files: File[]) => void;
  onError?: (error: string) => void;
  multiple?: boolean;
  accept?: string;
  maxFiles?: number;
  maxFileSize?: number; // in MB
}

interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export function IOSFilePicker({ 
  onFilesSelected, 
  onError, 
  multiple = true, 
  accept = 'audio/*',
  maxFiles = 50,
  maxFileSize = 50
}: IOSFilePickerProps) {
  const { theme } = useTheme();
  const [isLoading, setIsLoading] = React.useState(false);
  const [dragActive, setDragActive] = React.useState(false);
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // iOS-specific audio formats
  const SUPPORTED_AUDIO_FORMATS = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/x-wav',
    'audio/aac', 'audio/mp4', 'audio/x-m4a', 'audio/ogg', 'audio/webm',
    'audio/m4a', 'audio/aiff', 'audio/x-aiff', 'audio/flac', 'audio/x-flac',
    // iOS Safari specific
    'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mp3'
  ];

  const SUPPORTED_EXTENSIONS = [
    '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.webm', '.aiff', '.flac'
  ];

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  const validateFile = (file: File): FileValidationResult => {
    // Check file size
    if (file.size > maxFileSize * 1024 * 1024) {
      return {
        isValid: false,
        error: `File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB > ${maxFileSize}MB)`
      };
    }

    // Check MIME type first
    if (SUPPORTED_AUDIO_FORMATS.includes(file.type)) {
      return { isValid: true };
    }

    // Fallback to file extension check
    const fileName = file.name.toLowerCase();
    if (SUPPORTED_EXTENSIONS.some(ext => fileName.endsWith(ext))) {
      return { isValid: true };
    }

    return {
      isValid: false,
      error: `Unsupported file type: ${file.name} (${file.type})`
    };
  };

  const processFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    const errors: string[] = [];

    // Check max files limit
    if (fileArray.length > maxFiles) {
      errors.push(`Too many files selected: ${fileArray.length} > ${maxFiles}`);
    }

    // Validate each file
    fileArray.forEach(file => {
      const validation = validateFile(file);
      if (validation.isValid) {
        validFiles.push(file);
      } else if (validation.error) {
        errors.push(validation.error);
      }
    });

    setValidationErrors(errors);
    setSelectedFiles(validFiles);

    if (validFiles.length > 0) {
      onFilesSelected(validFiles);
    }

    if (errors.length > 0) {
      onError?.(`Validation errors: ${errors.join(', ')}`);
    }
  };

  const createIOSCompatibleFileInput = (): HTMLInputElement => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    
    // Enhanced accept string for iOS
    const acceptTypes = [
      'audio/*',
      '.mp3,.wav,.m4a,.aac,.ogg,.webm,.aiff,.flac',
      'audio/mpeg,audio/mp3,audio/wav,audio/wave,audio/x-wav,audio/aac,audio/mp4,audio/x-m4a,audio/ogg,audio/webm,audio/m4a,audio/aiff,audio/x-aiff,audio/flac,audio/x-flac'
    ].join(',');
    
    input.accept = acceptTypes;
    
    // iOS Safari specific attributes
    input.setAttribute('capture', 'none');
    input.setAttribute('webkitdirectory', 'false');
    input.setAttribute('data-ios', 'true');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    
    return input;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFiles(files);
    }
    // Reset input value to allow selecting the same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const triggerFileSelect = () => {
    if (isIOS) {
      console.log('🍎 iOS detected, using enhanced file picker...');
      
      const iosInput = createIOSCompatibleFileInput();
      
      iosInput.addEventListener('change', (event) => {
        console.log('iOS file input change event triggered');
        const target = event.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
          processFiles(target.files);
        }
      });
      
      iosInput.addEventListener('error', (event) => {
        console.error('iOS file input error:', event);
        onError?.('Failed to open file picker on iOS');
      });
      
      try {
        iosInput.click();
        console.log('iOS file picker triggered');
      } catch (error) {
        console.error('Failed to trigger iOS file picker:', error);
        onError?.('Failed to open file picker. Please try again.');
      }
    } else {
      // Fallback to standard file input
      fileInputRef.current?.click();
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.toLowerCase().split('.').pop();
    switch (ext) {
      case 'mp3':
        return '🎵';
      case 'wav':
        return '🔊';
      case 'm4a':
        return '📱';
      case 'aac':
        return '🎧';
      case 'ogg':
        return '🎼';
      default:
        return '📄';
    }
  };

  return (
    <div className="space-y-4">
      {/* File Input (Hidden) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload Area */}
      <Card 
        className={`border-2 border-dashed transition-colors ${
          dragActive 
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
            : 'border-gray-300 dark:border-gray-600'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <CardContent className="p-6">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <Upload className={`w-12 h-12 ${
                dragActive ? 'text-blue-500' : 'text-gray-400'
              }`} />
            </div>
            
            <div>
              <h3 className="text-lg font-medium">Upload Audio Files</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Drag and drop audio files here, or click to browse
              </p>
            </div>

            <div className="space-y-2">
              <Button
                onClick={triggerFileSelect}
                disabled={isLoading}
                className="bg-blue-600 hover:bg-blue-500 text-white"
              >
                <Smartphone className="w-4 h-4 mr-2" />
                {isLoading ? 'Selecting Files...' : 'Select Audio Files'}
              </Button>
              
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Supported: MP3, WAV, M4A, AAC, OGG, WebM, AIFF, FLAC
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Max {maxFileSize}MB per file • Up to {maxFiles} files
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* iOS-specific instructions */}
      {isIOS && (
        <Card className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
          <CardContent className="p-4">
            <div className="flex items-start space-x-3">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                  iOS File Selection Tips
                </h4>
                <ul className="text-yellow-700 dark:text-yellow-300 mt-1 space-y-1">
                  <li>• Tap "Browse" when prompted to access Files app</li>
                  <li>• Navigate to your audio files in Downloads or Music</li>
                  <li>• Select multiple files by tapping each one</li>
                  <li>• Tap "Done" to confirm your selection</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selected Files */}
      {selectedFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <span>Selected Files ({selectedFiles.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-lg">{getFileIcon(file.name)}</span>
                    <div>
                      <p className="font-medium text-sm">{file.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-green-600 dark:text-green-400">
                    ✓ Valid
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-red-800 dark:text-red-200">
              <AlertCircle className="w-5 h-5" />
              <span>Validation Errors ({validationErrors.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {validationErrors.map((error, index) => (
                <div key={index} className="text-sm text-red-700 dark:text-red-300">
                  • {error}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
