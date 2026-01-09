import React from 'react';
import { useGlobalPlaybackManager } from './useGlobalPlaybackManager';

/**
 * iOS Audio Optimization Hook
 * Provides optimized audio handling for iOS devices, especially during bank switching
 */
export function useIOSAudioOptimization() {
  const playbackManager = useGlobalPlaybackManager();

  // Pre-unlock audio when switching banks
  const preUnlockForBankSwitch = React.useCallback(async () => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      console.log('🍎 Pre-unlocking audio for bank switch...');
      try {
        await playbackManager.preUnlockAudio();
        console.log('✅ Pre-unlock completed');
      } catch (error) {
        console.error('❌ Pre-unlock failed:', error);
      }
    }
  }, [playbackManager]);

  // Optimized pad play with pre-unlock
  const playPadOptimized = React.useCallback(async (padId: string) => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      // For iOS, try to pre-unlock if needed
      const iosService = (window as any).getIOSAudioService?.();
      if (iosService && !iosService.isUnlocked()) {
        console.log('🔓 Pre-unlocking before playing pad...');
        await playbackManager.preUnlockAudio();
      }
    }
    
    // Now play the pad
    playbackManager.playPad(padId);
  }, [playbackManager]);

  return {
    preUnlockForBankSwitch,
    playPadOptimized,
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent)
  };
}

/**
 * iOS Audio Optimization Component
 * Automatically handles iOS audio optimization
 */
export function IOSAudioOptimizer({ children }: { children: React.ReactNode }) {
  const { preUnlockForBankSwitch } = useIOSAudioOptimization();
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  React.useEffect(() => {
    if (!isIOS) return;

    // Pre-unlock on first user interaction
    const handleFirstInteraction = () => {
      preUnlockForBankSwitch();
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
    };

    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    document.addEventListener('click', handleFirstInteraction, { once: true });

    return () => {
      document.removeEventListener('touchstart', handleFirstInteraction);
      document.removeEventListener('click', handleFirstInteraction);
    };
  }, [isIOS, preUnlockForBankSwitch]);

  return React.createElement(React.Fragment, null, children);
}
