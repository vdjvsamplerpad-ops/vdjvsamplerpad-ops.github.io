import * as React from 'react';
import { SamplerPadApp } from '@/components/sampler/SamplerPadApp';
import { GlobalErrorHandler } from '@/components/ui/global-error-handler';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useIOSAudioHelper } from '@/components/ui/ios-audio-helper';
import { AuthProvider } from '@/hooks/useAuth';
import { usePerformanceTier } from '@/hooks/usePerformanceTier';

function App() {
  const { IOSAudioHelper } = useIOSAudioHelper();
  const { tier } = usePerformanceTier();

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('perf-high', 'perf-medium', 'perf-low');
    root.classList.add(`perf-${tier}`);
  }, [tier]);

  return (
    <ErrorBoundary>
      <GlobalErrorHandler>
        <AuthProvider>
          <SamplerPadApp />
          <IOSAudioHelper />
        </AuthProvider>
      </GlobalErrorHandler>
    </ErrorBoundary>
  );
}

export default App;
