import * as React from 'react';
import { getIOSAudioService } from '../../../lib/ios-audio-service';

// --- CONFIGURATION ---
// Chrome limit is ~1000. We set a safety margin to 800.
const MAX_AUDIO_ELEMENTS = 800;

interface AudioInstance {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  volume: number;
  // Make audio element nullable for resource management
  audioElement: HTMLAudioElement | null;
  audioContext: AudioContext;
  sourceNode: MediaElementAudioSourceNode | null;
  gainNode: GainNode | null;
  filterNode: BiquadFilterNode | null;
  eqNodes: { low: BiquadFilterNode | null; mid: BiquadFilterNode | null; high: BiquadFilterNode | null };
  isPlaying: boolean;
  progress: number;
  triggerMode: 'toggle' | 'hold' | 'stutter' | 'unmute';
  playbackMode: 'once' | 'loop' | 'stopper';
  startTimeMs: number;
  endTimeMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  fadeIntervalId: NodeJS.Timeout | null;
  fadeAnimationFrameId: number | null;
  fadeMonitorFrameId: number | null;
  cleanupFunctions: (() => void)[];
  isFading: boolean;
  isConnected: boolean;
  lastAudioUrl: string | null;
  sourceConnected: boolean;
  fadeInStartTime: number | null;
  fadeOutStartTime: number | null;
  playStartTime: number | null;
  softMuted: boolean;
  nextPlayOverrides?: Partial<any>;
  lastUsedTime: number; 
}

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface GlobalPlaybackManager {
  registerPad: (padId: string, padData: any, bankId: string, bankName: string) => Promise<void>;
  unregisterPad: (padId: string) => void;
  playPad: (padId: string) => void;
  stopPad: (padId: string, mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') => void;
  togglePad: (padId: string) => void;
  updatePadSettings: (padId: string, settings: any) => void;
  updatePadSettingsNextPlay: (padId: string, settings: any) => void;
  updatePadMetadata: (padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }) => void;
  getPadState: (padId: string) => { isPlaying: boolean; progress: number } | null;
  getAllPlayingPads: () => { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; currentMs: number; endMs: number; playStartTime: number }[];
  stopAllPads: (mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') => void;
  setGlobalMute: (muted: boolean) => void;
  setMasterVolume: (volume: number) => void;
  applyGlobalEQ: (eqSettings: EqSettings) => void;
  updatePadVolume: (padId: string, volume: number) => void;
  addStateChangeListener: (listener: () => void) => void;
  removeStateChangeListener: (listener: () => void) => void;
  isPadRegistered: (padId: string) => boolean;
  getAllRegisteredPads: () => string[];
  playStutterPad: (padId: string) => void;
  toggleMutePad: (padId: string) => void;
  preUnlockAudio: () => Promise<void>;
}

class GlobalPlaybackManagerClass {
  private audioInstances: Map<string, AudioInstance> = new Map();
  private stateChangeListeners: Set<() => void> = new Set();
  private globalMuted: boolean = false;
  private masterVolume: number = 1;
  private globalEQ: EqSettings = { low: 0, mid: 0, high: 0 };
  private audioContext: AudioContext | null = null;
  private isIOS: boolean = false;
  private contextUnlocked: boolean = false;
  private silentAudio: HTMLAudioElement | null = null;
  private iosAudioService: any = null;
  private notificationTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

    if (this.isIOS) {
      this.iosAudioService = getIOSAudioService();
      this.iosAudioService.onUnlock(() => {
        this.contextUnlocked = true;
        this.audioContext = this.iosAudioService.getAudioContext();
      });

      window.addEventListener('ios-audio-control-pause', () => this.stopAllPads('fadeout'));
      window.addEventListener('ios-audio-control-stop', () => this.stopAllPads('instant'));
    }

    this.initializeAudioContext();
  }

  private initializeAudioContext() {
    if (this.audioContext) return;

    try {
      if (this.isIOS && this.iosAudioService) {
        this.audioContext = this.iosAudioService.getAudioContext();
        this.contextUnlocked = this.iosAudioService.isUnlocked();
        return;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();

      if (this.isIOS) this.createSilentAudio();
      if (!this.contextUnlocked) this.setupAudioContextUnlock();
    } catch (error) {
      console.error('Failed to create AudioContext:', error);
    }
  }

  private createSilentAudio() {
    this.silentAudio = new Audio();
    this.silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    this.silentAudio.loop = true;
    this.silentAudio.volume = 0.01;
  }

  private setupAudioContextUnlock() {
    const unlock = async () => {
      if (!this.audioContext || this.contextUnlocked) return;
      try {
        if (this.audioContext.state === 'suspended') await this.audioContext.resume();
        if (this.isIOS && this.silentAudio) {
           this.silentAudio.play().catch(() => {});
           // Also force load the silent audio
           this.silentAudio.load();
        }
        this.contextUnlocked = true;
        ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
          document.removeEventListener(event, unlock);
        });
      } catch (err) {
        console.error('Failed to unlock AudioContext:', err);
      }
    };
    ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
      document.addEventListener(event, unlock, { once: false, passive: true });
    });
  }

  // --- RESOURCE MANAGEMENT START ---

  private enforceAudioLimit() {
    let activeCount = 0;
    this.audioInstances.forEach(inst => {
      if (inst.audioElement) activeCount++;
    });

    if (activeCount < MAX_AUDIO_ELEMENTS) return;

    // Find candidates: Not playing, Not fading
    const candidates: AudioInstance[] = [];
    this.audioInstances.forEach(inst => {
      if (inst.audioElement && !inst.isPlaying && !inst.isFading) {
        candidates.push(inst);
      }
    });

    candidates.sort((a, b) => a.lastUsedTime - b.lastUsedTime);

    if (candidates.length > 0) {
      this.dehydrateInstance(candidates[0]);
    }
  }

  private dehydrateInstance(instance: AudioInstance) {
    if (!instance.audioElement) return;

    try {
      instance.cleanupFunctions.forEach(cleanup => {
        try { cleanup(); } catch (e) { }
      });
      instance.cleanupFunctions = [];

      instance.audioElement.pause();
      instance.audioElement.src = ''; 
      instance.audioElement.load(); 

      this.disconnectAudioNodes(instance);
      
      instance.audioElement = null;
      instance.sourceNode = null; 
      instance.isConnected = false;
      instance.sourceConnected = false;
    } catch (e) {
      console.error('Error dehydrating instance:', e);
    }
  }

  private ensureAudioResources(instance: AudioInstance): boolean {
    instance.lastUsedTime = Date.now();

    if (instance.audioElement) return true;
    if (!instance.lastAudioUrl) return false;

    try {
      this.enforceAudioLimit();

      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = instance.lastAudioUrl;
      audio.muted = false; // prevent direct output, route through gain node
      audio.volume = 1.0;
      audio.preload = this.isIOS ? 'auto' : 'metadata';
      (audio as any).playsInline = true;
      // Force all audible output through the Web Audio graph
      audio.muted = false;
      audio.volume = 1.0;

      if ('preservesPitch' in audio && !this.isIOS) {
        (audio as any).preservesPitch = false;
      }

      audio.playbackRate = Math.pow(2, (instance.pitch || 0) / 12);
      audio.loop = instance.playbackMode === 'loop';

      // --- CRITICAL IOS FIX: FORCE LOAD ---
      if (this.isIOS) {
        audio.load();
      }

      instance.audioElement = audio;

      const handleTimeUpdate = () => {
        if (!instance.audioElement) return;
        const currentTime = instance.audioElement.currentTime * 1000;
        const duration = (instance.endTimeMs || instance.audioElement.duration * 1000) - (instance.startTimeMs || 0);
        const currentProgress = ((currentTime - (instance.startTimeMs || 0)) / duration) * 100;
        instance.progress = Math.max(0, Math.min(100, currentProgress));

        // Fades are now handled by scheduled gain changes, no need to apply here
        // Only check for end time
        this.notifyStateChange();

        if (instance.endTimeMs > 0 && currentTime >= instance.endTimeMs) {
          if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
            this.stopPad(instance.padId, 'instant');
          } else if (instance.playbackMode === 'loop') {
            instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
          }
        }
      };

      const handleEnded = () => {
        if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
          instance.isPlaying = false;
          instance.progress = 0;
          instance.isFading = false;
          this.stopFadeAutomation(instance);
          this.notifyStateChange();
        }
      };

      const handleLoadedMetadata = () => {
        if (!instance.audioElement) return;
        if (instance.startTimeMs > 0) instance.audioElement.currentTime = instance.startTimeMs / 1000;
        if (instance.endTimeMs === 0) instance.endTimeMs = instance.audioElement.duration * 1000;
      };
      const handleCanPlayThrough = () => { };

      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('canplaythrough', handleCanPlayThrough);

      instance.cleanupFunctions.push(
        () => audio.removeEventListener('timeupdate', handleTimeUpdate),
        () => audio.removeEventListener('ended', handleEnded),
        () => audio.removeEventListener('loadedmetadata', handleLoadedMetadata),
        () => audio.removeEventListener('canplaythrough', handleCanPlayThrough)
      );

      return true;
    } catch (e) {
      console.error('Failed to hydrate audio instance:', e);
      return false;
    }
  }

  // --- RESOURCE MANAGEMENT END ---

  async registerPad(padId: string, padData: any, bankId: string, bankName: string): Promise<void> {
    if (!this.audioContext) this.initializeAudioContext();

    const existing = this.audioInstances.get(padId);

    if (existing && existing.lastAudioUrl === padData.audioUrl) {
      existing.padName = padData.name;
      existing.bankId = bankId;
      existing.bankName = bankName;
      existing.color = padData.color;
      existing.volume = padData.volume;
      this.updatePadSettings(padId, {
        triggerMode: padData.triggerMode,
        playbackMode: padData.playbackMode,
        startTimeMs: padData.startTimeMs,
        endTimeMs: padData.endTimeMs,
        fadeInMs: padData.fadeInMs,
        fadeOutMs: padData.fadeOutMs,
        pitch: padData.pitch
      });
      existing.lastUsedTime = Date.now(); 
      this.ensureAudioResources(existing);
      this.notifyStateChange();
      return;
    }

    if (existing) {
      this.cleanupInstance(existing);
    }

    if (!padData.audioUrl) return;

    const instance: AudioInstance = {
      padId,
      padName: padData.name,
      bankId,
      bankName,
      color: padData.color,
      volume: padData.volume,
      audioElement: null,
      audioContext: this.audioContext!,
      sourceNode: null,
      gainNode: null,
      filterNode: null,
      eqNodes: { low: null, mid: null, high: null },
      isPlaying: false,
      progress: 0,
      triggerMode: padData.triggerMode,
      playbackMode: padData.playbackMode,
      startTimeMs: padData.startTimeMs || 0,
      endTimeMs: padData.endTimeMs || 0,
      fadeInMs: padData.fadeInMs || 0,
      fadeOutMs: padData.fadeOutMs || 0,
      pitch: padData.pitch || 0,
      fadeIntervalId: null,
      fadeAnimationFrameId: null,
      fadeMonitorFrameId: null,
      cleanupFunctions: [],
      isFading: false,
      isConnected: false,
      lastAudioUrl: padData.audioUrl,
      sourceConnected: false,
      fadeInStartTime: null,
      fadeOutStartTime: null,
      playStartTime: null,
      softMuted: false,
      nextPlayOverrides: undefined,
      lastUsedTime: Date.now()
    };

    this.audioInstances.set(padId, instance);
    this.ensureAudioResources(instance);
    this.notifyStateChange();
  }

  private getBaseGain(instance: AudioInstance) {
    return this.globalMuted || instance.softMuted ? 0 : instance.volume * this.masterVolume;
  }

  private stopFadeAutomation(instance: AudioInstance) {
    if (instance.fadeIntervalId) {
      clearInterval(instance.fadeIntervalId);
      instance.fadeIntervalId = null;
    }
    if (instance.fadeAnimationFrameId !== null) {
      cancelAnimationFrame(instance.fadeAnimationFrameId);
      instance.fadeAnimationFrameId = null;
    }
    if (instance.fadeMonitorFrameId !== null) {
      cancelAnimationFrame(instance.fadeMonitorFrameId);
      instance.fadeMonitorFrameId = null;
    }
    if (instance.gainNode && this.audioContext) {
      // Cancel any scheduled ramps so new fades start cleanly.
      instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
    }
  }

  private setGain(instance: AudioInstance, gain: number) {
    if (!instance.gainNode || !this.audioContext) return;
    const safeGain = Math.max(0, gain);
    const now = this.audioContext.currentTime;
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(safeGain, now);
  }

  /**
   * Perform a manual gain ramp on the mixer (gain node) only.
   * This ensures audible volume matches the mixer slider, starting exactly
   * at `fromGain` and reaching `toGain` after `durationMs`.
   */
  private startManualFade(instance: AudioInstance, fromGain: number, toGain: number, durationMs: number, onComplete?: () => void) {
    if (!instance.gainNode || !this.audioContext) { if (onComplete) onComplete(); return; }

    const now = this.audioContext.currentTime;
    const duration = Math.max(0, durationMs) / 1000;
    const startGain = Math.max(0, fromGain);
    const endGain = Math.max(0, toGain);

    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setValueAtTime(startGain, now);
    instance.gainNode.gain.linearRampToValueAtTime(endGain, now + duration);

    if (durationMs === 0) {
      if (onComplete) onComplete();
    } else {
      setTimeout(() => { if (onComplete) onComplete(); }, durationMs);
    }
  }

  private startFadeOutMonitor(instance: AudioInstance) {
    if (!instance.audioElement) return;
    if (instance.fadeMonitorFrameId !== null) cancelAnimationFrame(instance.fadeMonitorFrameId);
    instance.fadeOutStartTime = null;

    const monitor = () => {
      if (!instance.audioElement || !instance.isPlaying) { instance.fadeMonitorFrameId = null; return; }

      const startMs = instance.startTimeMs || 0;
      const endMs = instance.endTimeMs > startMs
        ? instance.endTimeMs
        : (instance.audioElement.duration || 0) * 1000;

      const currentAbsMs = instance.audioElement.currentTime * 1000;
      const remainingMs = endMs - currentAbsMs;

      if (instance.fadeOutMs > 0 && remainingMs <= instance.fadeOutMs && instance.fadeOutStartTime === null) {
        const currentGain = instance.gainNode ? instance.gainNode.gain.value : this.getBaseGain(instance);
        instance.fadeOutStartTime = performance.now();
        instance.isFading = true;
        this.startManualFade(instance, currentGain, 0, Math.max(0, remainingMs), () => {
          instance.fadeOutStartTime = null;
          instance.isFading = false;
        });
      }

      instance.fadeMonitorFrameId = requestAnimationFrame(monitor);
    };

    instance.fadeMonitorFrameId = requestAnimationFrame(monitor);
  }

  private connectAudioNodes(instance: AudioInstance) {
    if (!this.audioContext || instance.isConnected || !instance.audioElement) return;

    try {
      if (!instance.sourceNode) {
        instance.sourceNode = this.audioContext.createMediaElementSource(instance.audioElement);
        instance.sourceConnected = true;
      }

      if (!instance.gainNode) instance.gainNode = this.audioContext.createGain();
      
      if (!instance.filterNode) {
        instance.filterNode = this.audioContext.createBiquadFilter();
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
      }

      if (!this.isIOS) {
        if (!instance.eqNodes.low) {
          instance.eqNodes.low = this.audioContext.createBiquadFilter();
          instance.eqNodes.low.type = 'peaking';
          instance.eqNodes.low.frequency.setValueAtTime(100, this.audioContext.currentTime);
        }
        if (!instance.eqNodes.mid) {
          instance.eqNodes.mid = this.audioContext.createBiquadFilter();
          instance.eqNodes.mid.type = 'peaking';
          instance.eqNodes.mid.frequency.setValueAtTime(1000, this.audioContext.currentTime);
        }
        if (!instance.eqNodes.high) {
          instance.eqNodes.high = this.audioContext.createBiquadFilter();
          instance.eqNodes.high.frequency.setValueAtTime(10000, this.audioContext.currentTime);
        }
      }

      if (instance.sourceNode) {
        if (this.isIOS) {
          instance.sourceNode.connect(instance.filterNode!);
          instance.filterNode!.connect(instance.gainNode!);
        } else {
          instance.sourceNode.connect(instance.eqNodes.low!);
          instance.eqNodes.low!.connect(instance.eqNodes.mid!);
          instance.eqNodes.mid!.connect(instance.eqNodes.high!);
          instance.eqNodes.high!.connect(instance.filterNode!);
          instance.filterNode!.connect(instance.gainNode!);
        }
        instance.gainNode!.connect(this.audioContext.destination);
      }

      instance.isConnected = true;
      this.applyGlobalSettingsToInstance(instance);
    } catch (error) {
      console.error('Failed to connect audio nodes:', error);
      instance.isConnected = false;
    }
  }

  private disconnectAudioNodes(instance: AudioInstance) {
    if (!instance.isConnected) return;
    try {
      if (!this.isIOS) {
        instance.gainNode?.disconnect();
        instance.filterNode?.disconnect();
        instance.eqNodes.high?.disconnect();
        instance.eqNodes.mid?.disconnect();
        instance.eqNodes.low?.disconnect();
        instance.sourceNode?.disconnect();
      }
      instance.isConnected = false;
    } catch (error) {
      console.warn('Error disconnecting audio nodes:', error);
    }
  }

  playPad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;

    const isReady = this.ensureAudioResources(instance);
    if (!isReady) {
      console.error('Could not allocate audio resource for pad:', padId);
      return;
    }

    instance.lastUsedTime = Date.now();

    if (this.isIOS && this.iosAudioService) {
      if (!this.iosAudioService.isUnlocked()) {
        const unlockTimeout = setTimeout(() => {
          // REDUCED TIMEOUT FROM 2000 TO 300 to fix lag
          console.log('⏰ iOS unlock timeout, proceeding anyway...');
          this.proceedWithPlay(instance);
        }, 300);

        this.iosAudioService.forceUnlock().then((unlocked: boolean) => {
          clearTimeout(unlockTimeout);
          if (unlocked) {
            this.contextUnlocked = true;
            this.audioContext = this.iosAudioService.getAudioContext();
          }
          this.proceedWithPlay(instance);
        }).catch(() => {
          clearTimeout(unlockTimeout);
          this.proceedWithPlay(instance);
        });
        return;
      }
    }

    if (!this.contextUnlocked && this.audioContext) {
      const tryResume = this.audioContext.state === 'suspended' ? this.audioContext.resume() : Promise.resolve();
      // Force silent audio to play to wake up engine
      const trySilent = this.isIOS && this.silentAudio ? this.silentAudio.play().catch(() => {}) : Promise.resolve();
      
      Promise.all([tryResume, trySilent]).then(() => {
        this.contextUnlocked = !!this.audioContext && this.audioContext.state === 'running';
        if (this.contextUnlocked) this.proceedWithPlay(instance);
        else this.proceedWithPlay(instance); // Proceed anyway to try
      });
      return; 
    }

    this.proceedWithPlay(instance);
  }

  private proceedWithPlay(instance: AudioInstance): void {
    if (!instance.audioElement) return;

    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch(err => console.error(err));
    }

    if (!instance.isConnected) {
      this.connectAudioNodes(instance);
    }

    this._applyNextPlayOverrides(instance);

    if (instance.triggerMode === 'unmute' && instance.isPlaying) {
      instance.softMuted = !instance.softMuted;
      const targetGain = this.getBaseGain(instance);
      this.setGain(instance, targetGain);
      this.notifyStateChange();
      return;
    }

    if (instance.playbackMode === 'stopper') {
      this.audioInstances.forEach(other => {
        if (other.padId !== instance.padId && other.isPlaying) this.stopPad(other.padId, 'instant');
      });
    }

    instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
    
    // Aggressive load if not ready
    if (this.isIOS && instance.audioElement.readyState < 2) {
      try { instance.audioElement.load(); } catch {}
    }

    this.stopFadeAutomation(instance);
    instance.fadeInStartTime = instance.fadeInMs > 0 ? performance.now() : null;
    instance.fadeOutStartTime = null;

    const baseGainBeforePlay = this.getBaseGain(instance);
    const initialGainBeforePlay = instance.fadeInMs > 0 ? 0 : baseGainBeforePlay;
    // Ensure the HTML audio element itself never leaks audio; all sound goes through the gain node.
    instance.audioElement.muted = true;
    instance.audioElement.volume = 1.0;
    this.setGain(instance, initialGainBeforePlay);

    const playPromise = instance.audioElement.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          instance.isPlaying = true;
          instance.playStartTime = Date.now();
          if (instance.audioElement) instance.audioElement.muted = false;
          instance.isFading = instance.fadeInMs > 0;
          this.resetInstanceAudio(instance);

          const baseGain = this.getBaseGain(instance);
          const initialGain = instance.fadeInMs > 0 ? 0 : baseGain;
          this.setGain(instance, initialGain);

          if (instance.fadeInMs > 0) {
            this.startManualFade(instance, initialGain, baseGain, instance.fadeInMs, () => {
              instance.fadeInStartTime = null;
              instance.isFading = false;
            });
          } else {
            this.setGain(instance, baseGain);
          }

          this.startFadeOutMonitor(instance);
          
          this.notifyStateChange();
        })
        .catch(error => console.error('Failed to play audio:', error));
    }
  }

  private stopPadInstant(instance: AudioInstance): void {
    if (!instance.audioElement) {
        instance.isPlaying = false;
        instance.isFading = false;
        this.notifyStateChange();
        return;
    }
    instance.audioElement.pause();
    instance.isPlaying = false;
    instance.progress = 0;
    instance.isFading = false;
    instance.fadeInStartTime = null;
    instance.fadeOutStartTime = null;
    instance.playStartTime = null;
    instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;

    if (!this.isIOS) this.disconnectAudioNodes(instance);
    this.stopFadeAutomation(instance);
    this.resetInstanceAudio(instance);
    this.notifyStateChange();
  }

  private stopPadFadeout(instance: AudioInstance): void {
    if (!instance.audioElement) { this.stopPadInstant(instance); return; }
    this.stopFadeAutomation(instance);
    instance.isFading = true;
    const durationMs = instance.fadeOutMs > 0 ? instance.fadeOutMs : 1000;
    this.applyManualFadeOut(instance, () => this.stopPadInstant(instance), durationMs);
  }

  private stopPadBrake(instance: AudioInstance): void {
    if (!instance.audioElement) { this.stopPadInstant(instance); return; }
    const originalRate = instance.audioElement.playbackRate;
    const steps = 30;
    let currentStep = 0;
    instance.isFading = true;

    const brakeInterval = setInterval(() => {
      if (currentStep < steps && instance.isPlaying && instance.audioElement) {
        currentStep++;
        const newRate = originalRate * (1 - (currentStep / steps * 0.95));
        instance.audioElement.playbackRate = Math.max(0.1, newRate);
      } else {
        clearInterval(brakeInterval);
        if (instance.audioElement) instance.audioElement.playbackRate = originalRate;
        this.stopPadInstant(instance);
      }
    }, 50);
  }

  private stopPadBackspin(instance: AudioInstance): void {
    if (!instance.audioElement) { this.stopPadInstant(instance); return; }
    const originalRate = instance.audioElement.playbackRate;
    const steps = 20;
    let currentStep = 0;
    instance.isFading = true;

    const backspinInterval = setInterval(() => {
      if (currentStep < steps && instance.isPlaying && instance.audioElement) {
        currentStep++;
        if (currentStep < steps / 2) {
          const newRate = originalRate * (1 + (currentStep / (steps / 2) * 2));
          instance.audioElement.playbackRate = Math.min(3, newRate);
        } else {
          const fadeStep = currentStep - steps / 2;
          const fadeVolume = (1 - fadeStep / (steps / 2));
          const targetGain = this.globalMuted ? 0 : instance.volume * this.masterVolume * fadeVolume;
          if (instance.gainNode && this.audioContext) {
            instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            instance.gainNode.gain.setValueAtTime(Math.max(0, targetGain), this.audioContext.currentTime);
          }
        }
      } else {
        clearInterval(backspinInterval);
        if (instance.audioElement) instance.audioElement.playbackRate = originalRate;
        this.stopPadInstant(instance);
      }
    }, 50);
  }

  private stopPadFilter(instance: AudioInstance): void {
    if (!instance.filterNode || !this.audioContext) {
      this.stopPadInstant(instance);
      return;
    }
    const duration = 1.5;
    instance.isFading = true;
    instance.filterNode.frequency.cancelScheduledValues(this.audioContext.currentTime);
    instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
    instance.filterNode.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + duration);

    setTimeout(() => {
      if (instance.isPlaying) this.stopPadInstant(instance);
      if (instance.filterNode && this.audioContext) instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
    }, duration * 1000);
  }

  private applyManualFadeOut(instance: AudioInstance, callback: () => void, durationMs: number): void {
    if (!instance.gainNode || !this.audioContext) { callback(); return; }
    instance.isFading = true;
    const currentGain = instance.gainNode.gain.value;
    this.startManualFade(instance, currentGain, 0, durationMs, () => {
      instance.isFading = false;
      callback();
    });
  }

  private resetInstanceAudio(instance: AudioInstance): void {
    if (!instance.audioElement) return;
    if (instance.startTimeMs > 0) instance.audioElement.currentTime = instance.startTimeMs / 1000;
    if (!(instance.fadeInMs > 0 && instance.fadeInStartTime === null)) this.updateInstanceVolume(instance);
    instance.audioElement.playbackRate = Math.pow(2, instance.pitch / 12);
    if (instance.filterNode && this.audioContext) instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
  }

  private updateInstanceVolume(instance: AudioInstance): void {
    if (instance.isFading || !instance.isConnected || !instance.gainNode || !this.audioContext || !instance.audioElement) return;
    if (instance.fadeInStartTime || instance.fadeOutStartTime) return;
    const targetVolume = this.globalMuted ? 0 : instance.volume * this.masterVolume;
    instance.audioElement.volume = 1.0;
    instance.gainNode.gain.setValueAtTime(targetVolume, this.audioContext.currentTime);
  }

  private updateInstanceEQ(instance: AudioInstance): void {
    if (!instance.isConnected || !this.audioContext || this.isIOS) return;
    const { low, mid, high } = instance.eqNodes;
    if (low) low.gain.setValueAtTime(this.globalEQ.low, this.audioContext.currentTime);
    if (mid) mid.gain.setValueAtTime(this.globalEQ.mid, this.audioContext.currentTime);
    if (high) high.gain.setValueAtTime(this.globalEQ.high, this.audioContext.currentTime);
  }

  private applyGlobalSettingsToInstance(instance: AudioInstance): void {
    this.updateInstanceVolume(instance);
    this.updateInstanceEQ(instance);
  }

  private notifyStateChange(): void {
    if (this.notificationTimeout) clearTimeout(this.notificationTimeout);
    this.notificationTimeout = setTimeout(() => {
      this.stateChangeListeners.forEach(listener => { try { listener(); } catch (e) { } });
    }, 16);
  }

  private cleanupInstance(instance: AudioInstance) {
    if (instance.isPlaying) this.stopPad(instance.padId, 'instant');
    this.stopFadeAutomation(instance);
    
    this.dehydrateInstance(instance);

    instance.isPlaying = false;
    instance.isFading = false;
    instance.progress = 0;
  }
  
  private _applyNextPlayOverrides(instance: AudioInstance) {
    const o = instance.nextPlayOverrides;
    if (!o) return;
    if (!instance.audioElement) return; 

    if (typeof o.padName === 'string') instance.padName = o.padName;
    if (typeof o.name === 'string') instance.padName = o.name;
    if (typeof o.color === 'string') instance.color = o.color;
    if (typeof o.bankId === 'string') instance.bankId = o.bankId;
    if (typeof o.bankName === 'string') instance.bankName = o.bankName;
    
    if (typeof o.triggerMode !== 'undefined') instance.triggerMode = o.triggerMode;
    if (typeof o.playbackMode !== 'undefined') {
      instance.playbackMode = o.playbackMode;
      instance.audioElement.loop = o.playbackMode === 'loop';
    }
    
    if (typeof o.startTimeMs === 'number') instance.startTimeMs = Math.max(0, o.startTimeMs);
    if (typeof o.endTimeMs === 'number') instance.endTimeMs = Math.max(0, o.endTimeMs);
    if (typeof o.fadeInMs === 'number') instance.fadeInMs = Math.max(0, o.fadeInMs);
    if (typeof o.fadeOutMs === 'number') instance.fadeOutMs = Math.max(0, o.fadeOutMs);
    if (typeof o.pitch === 'number') instance.pitch = o.pitch;
    if (typeof o.volume === 'number') instance.volume = o.volume;

    instance.nextPlayOverrides = undefined;
  }

  stopPad(padId: string, mode: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter' = 'instant'): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.fadeIntervalId) { clearInterval(instance.fadeIntervalId); instance.fadeIntervalId = null; }
    switch (mode) {
      case 'instant': this.stopPadInstant(instance); break;
      case 'fadeout': this.stopPadFadeout(instance); break;
      case 'brake': this.stopPadBrake(instance); break;
      case 'backspin': this.stopPadBackspin(instance); break;
      case 'filter': this.stopPadFilter(instance); break;
    }
  }

  unregisterPad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    this.cleanupInstance(instance);
    this.audioInstances.delete(padId);
    this.notifyStateChange();
  }

  togglePad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.isPlaying) this.stopPad(padId);
    else this.playPad(padId);
  }

  updatePadSettings(padId: string, settings: any): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    
    const fadeSettingsChanged = 
      settings.fadeInMs !== undefined || 
      settings.fadeOutMs !== undefined || 
      settings.startTimeMs !== undefined || 
      settings.endTimeMs !== undefined;
    
    if (settings.triggerMode !== undefined) instance.triggerMode = settings.triggerMode;
    if (settings.playbackMode !== undefined) {
      instance.playbackMode = settings.playbackMode;
      if (instance.audioElement) instance.audioElement.loop = settings.playbackMode === 'loop';
    }
    if (settings.startTimeMs !== undefined) instance.startTimeMs = settings.startTimeMs;
    if (settings.endTimeMs !== undefined) instance.endTimeMs = settings.endTimeMs;
    if (settings.fadeInMs !== undefined) instance.fadeInMs = settings.fadeInMs;
    if (settings.fadeOutMs !== undefined) instance.fadeOutMs = settings.fadeOutMs;
    if (settings.pitch !== undefined) {
      instance.pitch = settings.pitch;
      if (instance.audioElement) instance.audioElement.playbackRate = Math.pow(2, settings.pitch / 12);
    }
    if (settings.volume !== undefined) {
      instance.volume = settings.volume;
      this.updateInstanceVolume(instance);
    }
    
    // Re-schedule fade out monitoring if settings changed while playing
    if (fadeSettingsChanged && instance.isPlaying && !instance.isFading) {
      instance.fadeOutStartTime = null;
      this.startFadeOutMonitor(instance);
    }
  }

  updatePadSettingsNextPlay(padId: string, settings: any): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    instance.nextPlayOverrides = { ...(instance.nextPlayOverrides || {}), ...settings };
  }

  updatePadMetadata(padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (metadata.name !== undefined) instance.padName = metadata.name;
    if (metadata.color !== undefined) instance.color = metadata.color;
    if (metadata.bankId !== undefined) instance.bankId = metadata.bankId;
    if (metadata.bankName !== undefined) instance.bankName = metadata.bankName;
    this.notifyStateChange();
  }

  private computeEffectiveVolumeFactor(instance: AudioInstance, _nowAbsMs?: number): number {
    const base = this.getBaseGain(instance);
    if (base <= 0) return 0;
    const currentGain = instance.gainNode ? instance.gainNode.gain.value : base;
    return Math.max(0, Math.min(1, currentGain / base));
  }

  getPadState(padId: string): { isPlaying: boolean; progress: number; effectiveVolume: number } | null {
    const instance = this.audioInstances.get(padId);
    if (!instance) return null;
    const factor = this.computeEffectiveVolumeFactor(instance);
    return {
      isPlaying: instance.isPlaying,
      progress: instance.progress,
      effectiveVolume: instance.volume * factor
    };
  }
  
  getAllPlayingPads() {
      const playing: any[] = [];
      this.audioInstances.forEach(instance => {
          if (instance.isPlaying && instance.audioElement) {
              const nowAbsMs = instance.audioElement.currentTime * 1000;
              const regionStart = instance.startTimeMs || 0;
              const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
              const currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
              const endRelMs = Math.max(0, regionEnd - regionStart);
              const factor = this.computeEffectiveVolumeFactor(instance, nowAbsMs);
              playing.push({
                  padId: instance.padId,
                  padName: instance.padName,
                  bankId: instance.bankId,
                  bankName: instance.bankName,
                  color: instance.color,
                  volume: instance.volume,
                  effectiveVolume: instance.volume * factor,
                  currentMs: currentRelMs,
                  endMs: endRelMs,
                  playStartTime: instance.playStartTime || 0
              });
          }
      });
      return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
  }

  stopAllPads(mode: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter' = 'instant'): void {
    this.audioInstances.forEach(instance => {
      if (instance.isPlaying) this.stopPad(instance.padId, mode);
    });
  }

  setGlobalMute(muted: boolean): void {
    this.globalMuted = muted;
    this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = volume;
    this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
  }

  applyGlobalEQ(eqSettings: EqSettings): void {
    this.globalEQ = eqSettings;
    this.audioInstances.forEach(instance => this.updateInstanceEQ(instance));
  }

  updatePadVolume(padId: string, volume: number): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    instance.volume = volume;
    this.updateInstanceVolume(instance);
    this.notifyStateChange();
  }

  addStateChangeListener(listener: () => void): void { this.stateChangeListeners.add(listener); }
  removeStateChangeListener(listener: () => void): void { this.stateChangeListeners.delete(listener); }
  isPadRegistered(padId: string): boolean { return this.audioInstances.has(padId); }
  getAllRegisteredPads(): string[] { return Array.from(this.audioInstances.keys()); }
  playStutterPad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    this.stopPad(padId, 'instant');
    setTimeout(() => { this.playPad(padId); }, 5);
  }
  toggleMutePad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance || !instance.audioElement) return;
    instance.audioElement.muted = !instance.audioElement.muted;
    this.notifyStateChange();
  }
  
  getDebugInfo() { return { totalInstances: this.audioInstances.size, activeElements: Array.from(this.audioInstances.values()).filter(i => i.audioElement).length }; }
  getIOSDebugInfo() { return {}; }
  forceIOSUnlock() { return Promise.resolve(false); }
  preUnlockAudio() { return Promise.resolve(); }
}

const globalPlaybackManager = new GlobalPlaybackManagerClass();

export function useGlobalPlaybackManager(): GlobalPlaybackManager {
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    globalPlaybackManager.addStateChangeListener(forceUpdate);
    return () => {
      globalPlaybackManager.removeStateChangeListener(forceUpdate);
    };
  }, []);

  return {
    registerPad: (padId: string, padData: any, bankId: string, bankName: string) =>
      globalPlaybackManager.registerPad(padId, padData, bankId, bankName),
    unregisterPad: (padId: string) =>
      globalPlaybackManager.unregisterPad(padId),
    playPad: (padId: string) =>
      globalPlaybackManager.playPad(padId),
    stopPad: (padId: string, mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') =>
      globalPlaybackManager.stopPad(padId, mode),
    togglePad: (padId: string) =>
      globalPlaybackManager.togglePad(padId),
    updatePadSettings: (padId: string, settings: any) =>
      globalPlaybackManager.updatePadSettings(padId, settings),
    updatePadSettingsNextPlay: (padId: string, settings: any) =>
      globalPlaybackManager.updatePadSettingsNextPlay(padId, settings),
    updatePadMetadata: (padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }) =>
      globalPlaybackManager.updatePadMetadata(padId, metadata),
    getPadState: (padId: string) =>
      globalPlaybackManager.getPadState(padId),
    getAllPlayingPads: () =>
      globalPlaybackManager.getAllPlayingPads(),
    stopAllPads: (mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter') =>
      globalPlaybackManager.stopAllPads(mode),
    setGlobalMute: (muted: boolean) =>
      globalPlaybackManager.setGlobalMute(muted),
    setMasterVolume: (volume: number) =>
      globalPlaybackManager.setMasterVolume(volume),
    applyGlobalEQ: (eqSettings: EqSettings) =>
      globalPlaybackManager.applyGlobalEQ(eqSettings),
    updatePadVolume: (padId: string, volume: number) =>
      globalPlaybackManager.updatePadVolume(padId, volume),
    addStateChangeListener: (listener: () => void) =>
      globalPlaybackManager.addStateChangeListener(listener),
    removeStateChangeListener: (listener: () => void) =>
      globalPlaybackManager.removeStateChangeListener(listener),
    isPadRegistered: (padId: string) =>
      globalPlaybackManager.isPadRegistered(padId),
    playStutterPad: (padId: string) =>
      globalPlaybackManager.playStutterPad(padId),
    toggleMutePad: (padId: string) =>
      globalPlaybackManager.toggleMutePad(padId),
    getAllRegisteredPads: () =>
      globalPlaybackManager.getAllRegisteredPads(),
    preUnlockAudio: () =>
      globalPlaybackManager.preUnlockAudio()
  };
}