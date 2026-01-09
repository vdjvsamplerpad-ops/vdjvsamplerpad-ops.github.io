import React from 'react';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { AlertTriangle, RefreshCw, Home, Bug, X } from 'lucide-react';

interface GlobalErrorHandlerProps {
  children: React.ReactNode;
}

interface ErrorState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorId: string;
  showError: boolean;
}

export function GlobalErrorHandler({ children }: GlobalErrorHandlerProps) {
  const [errorState, setErrorState] = React.useState<ErrorState>({
    error: null,
    errorInfo: null,
    errorId: '',
    showError: false
  });

  const handleError = React.useCallback((error: Error, errorInfo?: React.ErrorInfo) => {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.error('Global error caught:', error, errorInfo);
    
    setErrorState({
      error,
      errorInfo: errorInfo || null,
      errorId,
      showError: true
    });

    // Log to external service in production
    if (process.env.NODE_ENV === 'production') {
      const errorData = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo?.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        errorId
      };
      console.log('Error data for external service:', errorData);
    }
  }, []);

  const handleUnhandledRejection = React.useCallback((event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    handleError(error);
  }, [handleError]);

  const handleWindowError = React.useCallback((event: ErrorEvent) => {
    const error = event.error || new Error(event.message);
    handleError(error);
  }, [handleError]);

  React.useEffect(() => {
    // Add global error listeners
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [handleWindowError, handleUnhandledRejection]);

  const handleReset = () => {
    setErrorState(prev => ({ ...prev, showError: false }));
  };

  const handleReload = () => {
    window.location.reload();
  };

  const handleGoHome = () => {
    window.location.href = '/';
  };

  const handleReportBug = () => {
    const errorData = {
      errorId: errorState.errorId,
      message: errorState.error?.message,
      stack: errorState.error?.stack,
      componentStack: errorState.errorInfo?.componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent
    };

    const body = `Error Report (ID: ${errorData.errorId})

Error: ${errorData.message}

URL: ${errorData.url}
User Agent: ${errorData.userAgent}

Stack Trace:
${errorData.stack}

Component Stack:
${errorData.componentStack}

Please describe what you were doing when this error occurred:
`;

    const mailtoLink = `mailto:support@vdjv.com?subject=Error Report ${errorData.errorId}&body=${encodeURIComponent(body)}`;
    window.open(mailtoLink);
  };

  const handleClose = () => {
    setErrorState(prev => ({ ...prev, showError: false }));
  };

  if (errorState.showError && errorState.error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
        <Card className="w-full max-w-md relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 h-8 w-8 p-0"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
          
          <CardHeader className="text-center pr-8">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/20">
              <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-xl">Something went wrong</CardTitle>
            <CardDescription>
              An unexpected error occurred. Error ID: {errorState.errorId}
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                {errorState.error.message || 'Unknown error occurred'}
              </p>
            </div>
            
            <div className="flex flex-col gap-2">
              <Button onClick={handleReset} variant="default" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              
              <Button onClick={handleReload} variant="outline" className="w-full">
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Page
              </Button>
              
              <Button onClick={handleGoHome} variant="outline" className="w-full">
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </Button>
              
              <Button onClick={handleReportBug} variant="ghost" className="w-full">
                <Bug className="mr-2 h-4 w-4" />
                Report Bug
              </Button>
            </div>

            {process.env.NODE_ENV === 'development' && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  Show technical details (development only)
                </summary>
                <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto max-h-32">
                  {errorState.error.stack}
                </pre>
              </details>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
