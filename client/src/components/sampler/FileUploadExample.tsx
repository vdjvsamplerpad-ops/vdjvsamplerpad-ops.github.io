import React from 'react';
import { IOSFilePicker } from './IOSFilePicker';

/**
 * Example usage of the enhanced iOS File Picker
 */
export function FileUploadExample() {
  const [uploadedFiles, setUploadedFiles] = React.useState<File[]>([]);
  const [uploadError, setUploadError] = React.useState<string | null>(null);

  const handleFilesSelected = (files: File[]) => {
    console.log('Files selected:', files);
    setUploadedFiles(prev => [...prev, ...files]);
    setUploadError(null);
  };

  const handleUploadError = (error: string) => {
    console.error('Upload error:', error);
    setUploadError(error);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-2">Audio File Upload</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Upload your audio files to create sampler pads
        </p>
      </div>

      <IOSFilePicker
        onFilesSelected={handleFilesSelected}
        onError={handleUploadError}
        multiple={true}
        maxFiles={20}
        maxFileSize={50}
      />

      {uploadError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-700 dark:text-red-300">{uploadError}</p>
        </div>
      )}

      {uploadedFiles.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <h3 className="font-medium text-green-800 dark:text-green-200 mb-2">
            Successfully uploaded {uploadedFiles.length} files
          </h3>
          <div className="text-sm text-green-700 dark:text-green-300">
            {uploadedFiles.map((file, index) => (
              <div key={index}>• {file.name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
