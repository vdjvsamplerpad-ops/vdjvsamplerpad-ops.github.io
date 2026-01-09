import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Download, Upload, CheckCircle, AlertCircle } from 'lucide-react';

interface ProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  progress: number;
  status: 'loading' | 'success' | 'error';
  type: 'export' | 'import';
  theme?: 'light' | 'dark';
  errorMessage?: string;
  onRetry?: () => void;
}

export function ProgressDialog({
  open,
  onOpenChange,
  title,
  description,
  progress,
  status,
  type,
  theme = 'light',
  errorMessage,
  onRetry
}: ProgressDialogProps) {
  const getIcon = () => {
    if (status === 'success') {
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    }
    if (status === 'error') {
      return <AlertCircle className="w-6 h-6 text-red-500" />;
    }
    return type === 'export' 
      ? <Download className="w-6 h-6 text-blue-500" />
      : <Upload className="w-6 h-6 text-blue-500" />;
  };

  const getProgressColor = () => {
    if (status === 'success') return 'bg-green-500';
    if (status === 'error') return 'bg-red-500';
    return 'bg-blue-500';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`sm:max-w-md backdrop-blur-md ${
        theme === 'dark' ? 'bg-gray-800/95 border-gray-600' : 'bg-white/95 border-gray-300'
      }`}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
              status === 'success' 
                ? 'bg-green-100 dark:bg-green-900/30'
                : status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              {getIcon()}
            </div>
            <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
              {title}
            </DialogTitle>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          {description && (
            <p className={`text-sm ${theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              {description}
            </p>
          )}

          {status === 'loading' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                  Progress
                </span>
                <span className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
                  {Math.round(progress)}%
                </span>
              </div>
              <Progress 
                value={progress} 
                className="h-2"
              />
            </div>
          )}

          {status === 'success' && (
            <div className={`p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800`}>
              <p className="text-sm text-green-800 dark:text-green-200">
                {type === 'export' ? 'Bank exported successfully!' : 'Bank imported successfully!'}
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className={`p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800`}>
              <p className="text-sm text-red-800 dark:text-red-200">
                {errorMessage || `Failed to ${type} bank. Please try again.`}
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {status === 'loading' ? (
              <Button
                onClick={() => onOpenChange(false)}
                variant="outline"
                className="w-full"
                disabled
              >
                Processing...
              </Button>
            ) : status === 'error' && onRetry ? (
              <>
                <Button
                  onClick={onRetry}
                  variant="default"
                  className="flex-1"
                >
                  Retry
                </Button>
                <Button
                  onClick={() => onOpenChange(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Close
                </Button>
              </>
            ) : (
              <Button
                onClick={() => onOpenChange(false)}
                className="w-full"
              >
                {status === 'success' ? 'Done' : 'Close'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
