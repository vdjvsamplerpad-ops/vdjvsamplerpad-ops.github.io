import * as React from 'react';
import { SamplerPadApp } from '@/components/sampler/SamplerPadApp';
import { GlobalErrorHandler } from '@/components/ui/global-error-handler';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { useIOSAudioHelper } from '@/components/ui/ios-audio-helper';

function App() {
  const { IOSAudioHelper } = useIOSAudioHelper();

  return (
    <ErrorBoundary>
      <GlobalErrorHandler>
        <SamplerPadApp />
        <IOSAudioHelper />
      </GlobalErrorHandler>
    </ErrorBoundary>
  );
}

export default App;
