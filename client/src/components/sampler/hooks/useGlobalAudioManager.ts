import * as React from 'react';

// This hook is now replaced by useGlobalPlaybackManager
// Keeping for backward compatibility but redirecting to new system

import { useGlobalPlaybackManager } from './useGlobalPlaybackManager';

interface AudioControls {
  stop: () => void;
  setMuted: (muted: boolean) => void;
  fadeOutStop: () => void;
  brakeStop: () => void;
  backspinStop: () => void;
  filterStop: () => void;
}

interface GlobalAudioManager {
  registerAudioControl: (id: string, controls: AudioControls) => void;
  unregisterAudioControl: (id: string) => void;
  getAudioControl: (id: string) => AudioControls | undefined;
  getAllAudioControls: () => Map<string, AudioControls>;
  stopAll: (mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') => void;
  setGlobalMute: (muted: boolean) => void;
}

export function useGlobalAudioManager(): GlobalAudioManager {
  const playbackManager = useGlobalPlaybackManager();

  return {
    registerAudioControl: (id: string, controls: AudioControls) => {
      // This is now handled by the global playback manager directly
      console.log('Legacy registerAudioControl called for:', id);
    },
    unregisterAudioControl: (id: string) => {
      // This is now handled by the global playback manager directly
      console.log('Legacy unregisterAudioControl called for:', id);
    },
    getAudioControl: (id: string) => {
      // Map to new playback manager methods
      return {
        stop: () => playbackManager.stopPad(id, 'instant'),
        setMuted: (muted: boolean) => playbackManager.setGlobalMute(muted),
        fadeOutStop: () => playbackManager.stopPad(id, 'fadeout'),
        brakeStop: () => playbackManager.stopPad(id, 'brake'),
        backspinStop: () => playbackManager.stopPad(id, 'backspin'),
        filterStop: () => playbackManager.stopPad(id, 'filter')
      };
    },
    getAllAudioControls: () => {
      // Return empty map as controls are now centralized
      return new Map();
    },
    stopAll: (mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') => {
      playbackManager.stopAllPads(mode);
    },
    setGlobalMute: (muted: boolean) => {
      playbackManager.setGlobalMute(muted);
    }
  };
}
