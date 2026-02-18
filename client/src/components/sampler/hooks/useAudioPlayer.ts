import * as React from 'react';
import { PadData } from '../types/sampler';
import { useGlobalPlaybackManager } from './useGlobalPlaybackManager';

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface AudioPlayerState {
  isPlaying: boolean;
  progress: number;
  effectiveVolume: number;
  playAudio: () => void;
  stopAudio: () => void;
  fadeOutStop: () => void;
  brakeStop: () => void;
  backspinStop: () => void;
  filterStop: () => void;
  releaseAudio: () => void;
  queueNextPlaySettings: (updatedPad: PadData) => void;
}

export function useAudioPlayer(
  pad: PadData,
  bankId: string,
  bankName: string,
  globalMuted: boolean = false,
  masterVolume: number = 1,
  eqSettings: EqSettings = { low: 0, mid: 0, high: 0 }
): AudioPlayerState {
  const playbackManager = useGlobalPlaybackManager();
  const [isHolding, setIsHolding] = React.useState(false);
  const registeredRef = React.useRef(false);
  const padIdRef = React.useRef(pad.id);
  const audioStateCheckTimeoutRef = React.useRef<number | null>(null);

  // Register/update pad with global manager
  React.useEffect(() => {
    if (!pad.audioUrl) return;

    const registerPad = async () => {
      try {
        await playbackManager.registerPad(pad.id, pad, bankId, bankName);
        registeredRef.current = true;
        padIdRef.current = pad.id;
      } catch (error) {
        console.error('Failed to register pad:', pad.id, error);
      }
    };

    registerPad();

    // REMOVED: No cleanup on unmount - let pads persist across bank switches
    // Only the explicit removal functions should unregister pads
  }, [pad.audioUrl, pad.id]); // Only re-register if URL or ID changes

  // Update pad settings when they change
  React.useEffect(() => {
    if (registeredRef.current) {
      playbackManager.updatePadSettings(pad.id, {
        triggerMode: pad.triggerMode,
        playbackMode: pad.playbackMode,
        startTimeMs: pad.startTimeMs,
        endTimeMs: pad.endTimeMs,
        pitch: pad.pitch,
        volume: pad.volume,
        ignoreChannel: pad.ignoreChannel
      });
    }
  }, [
    pad.triggerMode,
    pad.playbackMode,
    pad.startTimeMs,
    pad.endTimeMs,
    pad.pitch,
    pad.volume,
    pad.ignoreChannel
  ]);

  // Update pad metadata when it changes
  React.useEffect(() => {
    if (registeredRef.current) {
      playbackManager.updatePadMetadata(pad.id, {
        name: pad.name,
        color: pad.color,
        bankId,
        bankName
      });
    }
  }, [pad.name, pad.color, bankId, bankName]);

  // Get current state from global manager
  const padState = playbackManager.getPadState(pad.id);
  const isPlaying = padState?.isPlaying || false;
  const progress = padState?.progress || 0;
  const effectiveVolume = padState?.effectiveVolume ?? pad.volume;

  React.useEffect(() => {
    if (pad.triggerMode === 'hold' && isHolding && !isPlaying) {
      setIsHolding(false);
    }
  }, [pad.triggerMode, isHolding, isPlaying]);

  const scheduleAudioStateCheck = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (audioStateCheckTimeoutRef.current !== null) {
      window.clearTimeout(audioStateCheckTimeoutRef.current);
    }
    audioStateCheckTimeoutRef.current = window.setTimeout(() => {
      try {
        const state = playbackManager.getAudioState();
        if (state.contextState !== 'running') {
          window.dispatchEvent(new CustomEvent('vdjv-audio-unlock-required', {
            detail: { contextState: state.contextState, padId: pad.id }
          }));
        } else {
          window.dispatchEvent(new Event('vdjv-audio-unlock-restored'));
        }
      } catch (error) {
        console.warn('Failed to check audio state after play attempt:', error);
      }
    }, 250);
  }, [playbackManager, pad.id]);

  React.useEffect(() => {
    return () => {
      if (audioStateCheckTimeoutRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(audioStateCheckTimeoutRef.current);
      }
    };
  }, []);

  const playAudio = React.useCallback(() => {
    const triggerPlayback = () => {
      switch (pad.triggerMode) {
        case 'toggle':
          playbackManager.triggerToggle(pad.id);
          break;
        case 'stutter':
          playbackManager.triggerStutter(pad.id);
          break;
        case 'hold':
          if (!isHolding) {
            setIsHolding(true);
            playbackManager.triggerHoldStart(pad.id);
          }
          break;
        case 'unmute':
          playbackManager.triggerUnmuteToggle(pad.id);
          break;
      }
      scheduleAudioStateCheck();
    };

    if (!registeredRef.current) {
      if (!pad.audioUrl) {
        console.warn('Trying to play unregistered pad with no audio URL:', pad.id);
        return;
      }
      void playbackManager
        .registerPad(pad.id, pad, bankId, bankName)
        .then(() => {
          registeredRef.current = true;
          padIdRef.current = pad.id;
          triggerPlayback();
        })
        .catch((error) => {
          console.warn('Failed late pad registration on play:', pad.id, error);
        });
      return;
    }

    triggerPlayback();
  }, [pad.id, pad.audioUrl, pad.triggerMode, pad, bankId, bankName, isHolding, playbackManager, scheduleAudioStateCheck]);

  const stopAudio = React.useCallback(() => {
    if (!registeredRef.current) return;
    playbackManager.stopPad(pad.id, 'instant');
    setIsHolding(false);
  }, [pad.id, playbackManager]);

  const fadeOutStop = React.useCallback(() => {
    if (!registeredRef.current) return;
    playbackManager.stopPad(pad.id, 'fadeout');
    setIsHolding(false);
  }, [pad.id, playbackManager]);

  const brakeStop = React.useCallback(() => {
    if (!registeredRef.current) return;
    playbackManager.stopPad(pad.id, 'brake');
    setIsHolding(false);
  }, [pad.id, playbackManager]);

  const backspinStop = React.useCallback(() => {
    if (!registeredRef.current) return;
    playbackManager.stopPad(pad.id, 'backspin');
    setIsHolding(false);
  }, [pad.id, playbackManager]);

  const filterStop = React.useCallback(() => {
    if (!registeredRef.current) return;
    playbackManager.stopPad(pad.id, 'filter');
    setIsHolding(false);
  }, [pad.id, playbackManager]);

  const releaseAudio = React.useCallback(() => {
    if (pad.triggerMode === 'hold' && isHolding) {
      setIsHolding(false);
      playbackManager.triggerHoldStop(pad.id);
    }
  }, [pad.id, pad.triggerMode, isHolding, playbackManager]);

const queueNextPlaySettings = React.useCallback((updatedPad: PadData) => {
    playbackManager.updatePadSettingsNextPlay(updatedPad.id, {
      name: updatedPad.name,
      color: updatedPad.color,
      imageUrl: updatedPad.imageUrl,
      imageData: updatedPad.imageData,
      startTimeMs: updatedPad.startTimeMs,
      endTimeMs: updatedPad.endTimeMs,
      fadeInMs: updatedPad.fadeInMs,
      fadeOutMs: updatedPad.fadeOutMs,
      pitch: updatedPad.pitch,
      volume: updatedPad.volume,      // include here if you want next-play for volume too
      triggerMode: updatedPad.triggerMode,
      playbackMode: updatedPad.playbackMode,
    });
  }, [playbackManager]);
  
   return {
    isPlaying,
    progress,
    effectiveVolume,
    playAudio,
    stopAudio,
    queueNextPlaySettings,
    fadeOutStop,
    brakeStop,
    backspinStop,
    filterStop,
    releaseAudio,
  };
}
