import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Download, Upload, CheckCircle, AlertCircle, Clock, ShieldCheck } from 'lucide-react';

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
  onLogin?: () => void;
  etaSeconds?: number | null;
  statusMessage?: string;
  showWarning?: boolean;
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
  onRetry,
  onLogin,
  etaSeconds,
  statusMessage,
  showWarning
}: ProgressDialogProps) {
  
  // Check if error message indicates login is required
  const needsLogin = errorMessage && (
    errorMessage.toLowerCase().includes('sign in') ||
    errorMessage.toLowerCase().includes('login required') ||
    errorMessage.toLowerCase().includes('please sign in')
  );
  
  const formatTime = (seconds: number) => {
    if (seconds === Infinity) return 'Calculating...';
    if (seconds < 2) return 'Almost there...';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const getIcon = () => {
    if (status === 'success') {
      return <CheckCircle className="w-6 h-6 text-green-500" />;
    }
    if (status === 'error') {
      return <AlertCircle className="w-6 h-6 text-red-500" />;
    }
    if (status === 'loading' && progress < 20 && type === 'import') {
      return <ShieldCheck className="w-6 h-6 text-blue-500 animate-pulse" />;
    }
    return type === 'export' 
      ? <Download className="w-6 h-6 text-blue-500" />
      : <Upload className="w-6 h-6 text-blue-500" />;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Inject styles for the flowing animation */}
      <style>{`
        @keyframes flow-glow {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-flow-glow {
          animation: flow-glow 1.5s infinite linear;
        }
      `}</style>

      <DialogContent className={`sm:max-w-md backdrop-blur-md transition-colors duration-200 ${
        theme === 'dark' ? 'bg-gray-800/95 border-gray-600' : 'bg-white/95 border-gray-300'
      }`}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
              status === 'success' 
                ? 'bg-green-100 dark:bg-green-900/30'
                : status === 'error'
                  ? 'bg-red-100 dark:bg-red-900/30'
                  : 'bg-blue-100 dark:bg-blue-900/30'
            }`}>
              {getIcon()}
            </div>
            <div className="flex-1">
              <DialogTitle className={theme === 'dark' ? 'text-white' : 'text-gray-900'}>
                {title}
              </DialogTitle>
              {status === 'loading' && statusMessage && (
                <p className={`text-xs mt-1 font-medium ${theme === 'dark' ? 'text-blue-300' : 'text-blue-600'}`}>
                  {statusMessage}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>
        
        <div className="space-y-4">
          {description && !statusMessage && (
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
                <span className={`font-mono ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {Math.round(progress)}%
                </span>
              </div>
              
              <div className="relative">
                {/* Base Progress Component */}
                <Progress 
                  value={progress} 
                  className="h-2 overflow-hidden"
                />
                
                {/* Flowing Glow Overlay */}
                {/* This div matches the width of the progress fill exactly */}
                <div 
                  className="absolute top-0 left-0 h-full overflow-hidden rounded-full pointer-events-none transition-all duration-300 ease-in-out"
                  style={{ width: `${progress}%` }}
                >
                  {/* This gradient moves across the filled area */}
                  <div className="w-full h-full animate-flow-glow bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                </div>
              </div>

              <div className="flex justify-between items-center text-xs mt-1">
                 {etaSeconds !== undefined && etaSeconds !== null && (
                  <div className={`flex items-center gap-1 ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                    <Clock className="w-3 h-3" />
                    <span>Est. remaining: {formatTime(etaSeconds)}</span>
                  </div>
                )}
              </div>

              {showWarning && (
                <div className={`mt-2 p-2 rounded text-xs font-medium flex gap-2 items-start animate-in fade-in slide-in-from-top-1 ${
                  theme === 'dark' ? 'bg-amber-900/30 text-amber-200' : 'bg-amber-50 text-amber-700'
                }`}>
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <p>It may take longer when verifying. Please wait, don't close the app.</p>
                </div>
              )}
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
            ) : status === 'error' && (needsLogin ? onLogin : onRetry) ? (
              <>
                <Button
                  onClick={needsLogin ? onLogin : onRetry}
                  variant="default"
                  className="flex-1"
                >
                  {needsLogin ? 'Login' : 'Retry'}
                </Button>
                <Button
                  onClick={() => onOpenChange(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Cancel
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