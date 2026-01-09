/**
 * Enhanced iOS Audio Service
 * Addresses iOS-specific audio playback issues including:
 * - AudioContext suspension
 * - Ringer switch muting
 * - Control Center interference
 * - User gesture requirements
 */

interface IOSAudioConfig {
  enableRingerBypass: boolean;
  enableControlCenterSupport: boolean;
  silentAudioInterval: number;
  unlockRetryCount: number;
  debugLogging: boolean;
}

interface IOSAudioState {
  isUnlocked: boolean;
  isRingerBypassed: boolean;
  lastUserInteraction: number;
  failureCount: number;
  contextState: string;
}

export class IOSAudioService {
  private config: IOSAudioConfig;
  private state: IOSAudioState;
  private audioContext: AudioContext | null = null;
  private silentAudio: HTMLAudioElement | null = null;
  private silentInterval: NodeJS.Timeout | null = null;
  private unlockListeners: Set<() => void> = new Set();
  private isIOS: boolean;
  
  constructor(config: Partial<IOSAudioConfig> = {}) {
    this.config = {
      enableRingerBypass: true,
      enableControlCenterSupport: true,
      silentAudioInterval: 30000, // 30 seconds
      unlockRetryCount: 3,
      debugLogging: true,
      ...config
    };

    this.state = {
      isUnlocked: false,
      isRingerBypassed: false,
      lastUserInteraction: 0,
      failureCount: 0,
      contextState: 'unknown'
    };

    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    
    if (this.isIOS) {
      this.log('🍎 iOS detected, initializing enhanced audio service...');
      this.initialize();
    }
  }

  private log(message: string, ...args: any[]) {
    if (this.config.debugLogging) {
      console.log(`[IOSAudioService] ${message}`, ...args);
    }
  }

  private async initialize() {
    this.setupAudioContext();
    this.setupSilentAudio();
    this.setupUnlockHandlers();
    this.setupControlCenterSupport();
    this.startSilentAudioLoop();
  }

  private setupAudioContext() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({
        sampleRate: 44100,
        latencyHint: 'interactive'
      });

      this.state.contextState = this.audioContext.state;
      this.log(`AudioContext created with state: ${this.audioContext.state}`);

      // Monitor context state changes
      this.audioContext.addEventListener('statechange', () => {
        this.state.contextState = this.audioContext!.state;
        this.log(`AudioContext state changed to: ${this.audioContext!.state}`);
        
        if (this.audioContext!.state === 'suspended') {
          this.state.isUnlocked = false;
          this.attemptUnlock('statechange');
        }
      });

    } catch (error) {
      this.log('❌ Failed to create AudioContext:', error);
    }
  }

  private setupSilentAudio() {
    if (!this.config.enableRingerBypass) return;

    try {
      // Create multiple silent audio elements for redundancy
      this.silentAudio = new Audio();
      
      // Use a longer, more robust silent audio file
      this.silentAudio.src = this.createSilentAudioDataURL();
      this.silentAudio.loop = true;
      this.silentAudio.volume = 0.01; // Very quiet but not zero
      this.silentAudio.preload = 'auto';
      
      // iOS-specific attributes
      (this.silentAudio as any).playsInline = true;
      (this.silentAudio as any).disableRemotePlayback = true;
      
      // Set up event listeners for silent audio
      this.silentAudio.addEventListener('canplaythrough', () => {
        this.log('🔇 Silent audio ready');
      });

      this.silentAudio.addEventListener('ended', () => {
        // Restart if it somehow stops
        if (this.state.isRingerBypassed) {
          this.silentAudio?.play().catch(() => {});
        }
      });

      this.silentAudio.addEventListener('error', (e) => {
        this.log('❌ Silent audio error:', e);
        this.recreateSilentAudio();
      });

    } catch (error) {
      this.log('❌ Failed to setup silent audio:', error);
    }
  }

  private createSilentAudioDataURL(): string {
    // Create a longer silent audio file (1 second of silence)
    const sampleRate = 44100;
    const duration = 1; // 1 second
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Silent audio data (all zeros)
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, 0, true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  }

  private recreateSilentAudio() {
    this.log('🔄 Recreating silent audio...');
    if (this.silentAudio) {
      this.silentAudio.pause();
      this.silentAudio.src = '';
    }
    
    setTimeout(() => {
      this.setupSilentAudio();
    }, 1000);
  }

  private setupUnlockHandlers() {
    // Comprehensive event list for iOS unlock
    const events = [
      'touchstart', 'touchend', 'touchmove',
      'click', 'mousedown', 'mouseup',
      'keydown', 'keyup',
      'focus', 'scroll',
      'gesturestart', 'gesturechange', 'gestureend',
      'orientationchange',
      'devicemotion', 'deviceorientation'
    ];

    const unlockHandler = (event: Event) => {
      this.state.lastUserInteraction = Date.now();
      this.attemptUnlock(event.type);
    };

    events.forEach(eventType => {
      document.addEventListener(eventType, unlockHandler, { 
        passive: true, 
        capture: true 
      });
    });

    // Special handling for visibility changes
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.log('📱 App became visible, attempting unlock...');
        this.attemptUnlock('visibilitychange');
      }
    });

    // Page focus handling
    window.addEventListener('focus', () => {
      this.log('🔄 Window focused, attempting unlock...');
      this.attemptUnlock('focus');
    });
  }

  private setupControlCenterSupport() {
    if (!this.config.enableControlCenterSupport) return;

    // Set up media session for Control Center integration
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: 'VDJV Sampler Pad',
        artist: 'Audio Sampler',
        album: 'Live Performance',
        artwork: [
          { src: '/assets/logo.png', sizes: '192x192', type: 'image/png' }
        ]
      });

      // Set up action handlers
      navigator.mediaSession.setActionHandler('play', () => {
        this.log('▶️ Control Center play requested');
        this.handleControlCenterPlay();
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        this.log('⏸️ Control Center pause requested');
        this.handleControlCenterPause();
      });

      navigator.mediaSession.setActionHandler('stop', () => {
        this.log('⏹️ Control Center stop requested');
        this.handleControlCenterStop();
      });

      this.log('🎛️ Control Center support enabled');
    }
  }

  private startSilentAudioLoop() {
    if (!this.config.enableRingerBypass || this.silentInterval) return;

    this.silentInterval = setInterval(() => {
      if (this.state.isRingerBypassed && this.silentAudio) {
        // Check if silent audio is still playing
        if (this.silentAudio.paused || this.silentAudio.ended) {
          this.log('🔄 Restarting silent audio...');
          this.silentAudio.play().catch(() => {});
        }
      }
    }, this.config.silentAudioInterval);

    this.log('🔁 Silent audio loop started');
  }

  public async attemptUnlock(trigger: string): Promise<boolean> {
    if (this.state.isUnlocked || !this.audioContext) {
      return this.state.isUnlocked;
    }

    this.log(`🔓 Attempting unlock (trigger: ${trigger})...`);

    try {
      // Strategy 1: Resume AudioContext (fastest)
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        this.log('✅ AudioContext resumed');
      }

      // Strategy 2: Start silent audio for ringer bypass (parallel)
      const silentAudioPromise = this.config.enableRingerBypass && this.silentAudio && !this.state.isRingerBypassed
        ? this.silentAudio.play().then(() => {
            this.state.isRingerBypassed = true;
            this.log('🔇 Silent audio started (ringer bypass active)');
          }).catch(error => {
            this.log('⚠️ Silent audio failed:', error);
          })
        : Promise.resolve();

      // Strategy 3: Create and play test oscillator (parallel)
      const oscillatorPromise = this.audioContext.state === 'running'
        ? Promise.resolve().then(() => {
            const oscillator = this.audioContext!.createOscillator();
            const gainNode = this.audioContext!.createGain();
            
            gainNode.gain.value = 0;
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext!.destination);
            
            oscillator.start();
            oscillator.stop(this.audioContext!.currentTime + 0.01);
            
            this.log('🎵 Test oscillator played');
          })
        : Promise.resolve();

      // Wait for all strategies to complete (parallel execution)
      await Promise.all([silentAudioPromise, oscillatorPromise]);

      // Check if unlock was successful
      const isUnlocked = this.audioContext.state === 'running';
      
      if (isUnlocked && !this.state.isUnlocked) {
        this.state.isUnlocked = true;
        this.state.failureCount = 0;
        this.log('🎉 AudioContext successfully unlocked!');
        this.notifyUnlockListeners();
      } else if (!isUnlocked) {
        this.state.failureCount++;
        this.log(`❌ Unlock failed (attempt ${this.state.failureCount})`);
      }

      return isUnlocked;

    } catch (error) {
      this.state.failureCount++;
      this.log('❌ Unlock attempt failed:', error);
      
      // Try recovery after multiple failures
      if (this.state.failureCount >= this.config.unlockRetryCount) {
        this.log('🔄 Attempting recovery...');
        this.recreateAudioContext();
      }
      
      return false;
    }
  }

  private recreateAudioContext() {
    this.log('🔄 Recreating AudioContext...');
    
    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (error) {
        this.log('⚠️ Error closing old AudioContext:', error);
      }
    }
    
    this.state.isUnlocked = false;
    this.state.failureCount = 0;
    
    setTimeout(() => {
      this.setupAudioContext();
    }, 1000);
  }

  private handleControlCenterPlay() {
    // Dispatch custom event for the main app to handle
    window.dispatchEvent(new CustomEvent('ios-audio-control-play'));
  }

  private handleControlCenterPause() {
    window.dispatchEvent(new CustomEvent('ios-audio-control-pause'));
  }

  private handleControlCenterStop() {
    window.dispatchEvent(new CustomEvent('ios-audio-control-stop'));
  }

  private notifyUnlockListeners() {
    this.unlockListeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        this.log('❌ Unlock listener error:', error);
      }
    });
  }

  // Public API
  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  public isUnlocked(): boolean {
    return this.state.isUnlocked && this.audioContext?.state === 'running';
  }

  public isRingerBypassed(): boolean {
    return this.state.isRingerBypassed;
  }

  public getState(): IOSAudioState {
    return { ...this.state };
  }

  public onUnlock(listener: () => void): () => void {
    this.unlockListeners.add(listener);
    return () => this.unlockListeners.delete(listener);
  }

  public async forceUnlock(): Promise<boolean> {
    this.log('🔨 Force unlock requested');
    return this.attemptUnlock('manual');
  }

  public updateMediaSession(title: string, artist?: string) {
    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
      navigator.mediaSession.metadata.title = title;
      if (artist) navigator.mediaSession.metadata.artist = artist;
    }
  }

  public destroy() {
    this.log('🧹 Destroying iOS Audio Service...');
    
    if (this.silentInterval) {
      clearInterval(this.silentInterval);
      this.silentInterval = null;
    }
    
    if (this.silentAudio) {
      this.silentAudio.pause();
      this.silentAudio.src = '';
      this.silentAudio = null;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (error) {
        this.log('⚠️ Error closing AudioContext:', error);
      }
    }
    
    this.unlockListeners.clear();
    this.state.isUnlocked = false;
    this.state.isRingerBypassed = false;
  }
}

// Singleton instance
let iosAudioService: IOSAudioService | null = null;

export function getIOSAudioService(): IOSAudioService {
  if (!iosAudioService) {
    iosAudioService = new IOSAudioService();
  }
  return iosAudioService;
}

export function createIOSAudioService(config?: Partial<IOSAudioConfig>): IOSAudioService {
  if (iosAudioService) {
    iosAudioService.destroy();
  }
  iosAudioService = new IOSAudioService(config);
  return iosAudioService;
}
