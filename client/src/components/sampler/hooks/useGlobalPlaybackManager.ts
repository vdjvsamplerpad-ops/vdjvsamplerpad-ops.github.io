import * as React from 'react';
import { getIOSAudioService } from '../../../lib/ios-audio-service';

// --- CONFIGURATION ---
// Chrome limit is ~1000. We set a safety margin to 800.
const MAX_AUDIO_ELEMENTS = 800;
// iOS-specific: Limit concurrent AudioBufferSourceNodes
const MAX_IOS_BUFFER_SOURCES = 32;
const IS_IOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/.test(navigator.userAgent);
// State change notification throttle (higher on iOS/Android for performance - reduced re-renders)
const NOTIFICATION_THROTTLE_MS = IS_IOS ? 100 : IS_ANDROID ? 50 : 16;
// iOS memory limit for decoded audio buffers (~50MB to stay safe on older devices)
const IOS_MAX_BUFFER_MEMORY = 50 * 1024 * 1024;
const MAX_PLAYBACK_CHANNELS = 8;

interface AudioInstance {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  volume: number;
  channelId: number | null;
  ignoreChannel: boolean;
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
  // iOS AudioBuffer optimization
  audioBuffer: AudioBuffer | null;
  bufferSourceNode: AudioBufferSourceNode | null;
  isBufferDecoding: boolean;
  bufferDuration: number;
  iosProgressInterval: NodeJS.Timeout | null;
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
  stopPad: (padId: string, mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter', keepChannel?: boolean) => void;
  togglePad: (padId: string) => void;
  triggerToggle: (padId: string) => void;
  triggerHoldStart: (padId: string) => void;
  triggerHoldStop: (padId: string) => void;
  triggerStutter: (padId: string) => void;
  triggerUnmuteToggle: (padId: string) => void;
  updatePadSettings: (padId: string, settings: any) => void;
  updatePadSettingsNextPlay: (padId: string, settings: any) => void;
  updatePadMetadata: (padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }) => void;
  getPadState: (padId: string) => { isPlaying: boolean; progress: number } | null;
  getAllPlayingPads: () => { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; currentMs: number; endMs: number; playStartTime: number; channelId?: number | null }[];
  getLegacyPlayingPads: () => { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; currentMs: number; endMs: number; playStartTime: number }[];
  getChannelStates: () => { channelId: number; channelVolume: number; pad: { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; effectiveVolume: number; currentMs: number; endMs: number; playStartTime: number; channelId?: number | null } | null }[];
  setChannelVolume: (channelId: number, volume: number) => void;
  getChannelVolume: (channelId: number) => number;
  stopChannel: (channelId: number) => void;
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
  // New diagnostic methods
  runDiagnostics: () => Promise<DiagnosticResult>;
  getAudioState: () => AudioSystemState;
}

export interface DiagnosticResult {
  contextState: string;
  isUnlocked: boolean;
  isIOS: boolean;
  silentAudioTest: { success: boolean; latencyMs: number };
  oscillatorTest: { success: boolean; latencyMs: number };
  bufferTest: { success: boolean; latencyMs: number };
  mediaElementTest: { success: boolean; latencyMs: number };
  totalInstances: number;
  activeBuffers: number;
}

export interface AudioSystemState {
  isIOS: boolean;
  contextState: string;
  isUnlocked: boolean;
  totalInstances: number;
  playingCount: number;
  bufferedCount: number;
  masterVolume: number;
  globalMuted: boolean;
}

class GlobalPlaybackManagerClass {
  private audioInstances: Map<string, AudioInstance> = new Map();
  private stateChangeListeners: Set<() => void> = new Set();
  private globalMuted: boolean = false;
  private masterVolume: number = 1;
  private globalEQ: EqSettings = { low: 0, mid: 0, high: 0 };
  private audioContext: AudioContext | null = null;
  private isIOS: boolean = false;
  private isAndroid: boolean = false;
  private contextUnlocked: boolean = false;
  private silentAudio: HTMLAudioElement | null = null;
  private iosAudioService: any = null;
  private notificationTimeout: NodeJS.Timeout | null = null;
  // iOS optimization: shared gain node for all buffer sources
  private sharedIOSGainNode: GainNode | null = null;
  private channelAssignments: Map<number, string> = new Map();
  private channelVolumes: Map<number, number> = new Map();
  // Pre-warming state
  private isPrewarmed: boolean = false;
  // Audio buffer cache for iOS with memory tracking
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private bufferMemoryUsage: number = 0;
  private bufferAccessTime: Map<string, number> = new Map();

  constructor() {
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      this.channelVolumes.set(i, 1);
    }

    if (this.isIOS) {
      this.iosAudioService = getIOSAudioService();
      this.iosAudioService.onUnlock(() => {
        this.contextUnlocked = true;
        this.audioContext = this.iosAudioService.getAudioContext();
        this.setupSharedIOSNodes();
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
        if (this.contextUnlocked) {
          this.setupSharedIOSNodes();
        }
        return;
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({
        latencyHint: 'interactive',
        sampleRate: 44100
      });

      if (this.isIOS) {
        this.createSilentAudio();
        this.setupSharedIOSNodes();
      }
      if (!this.contextUnlocked) this.setupAudioContextUnlock();
    } catch (error) {
      console.error('Failed to create AudioContext:', error);
    }
  }

  // iOS optimization: Create shared gain node for all buffer playback
  private setupSharedIOSNodes() {
    if (!this.audioContext || this.sharedIOSGainNode) return;
    
    try {
      this.sharedIOSGainNode = this.audioContext.createGain();
      this.sharedIOSGainNode.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
      this.sharedIOSGainNode.connect(this.audioContext.destination);
      console.log('🎧 iOS shared audio nodes created');
    } catch (error) {
      console.error('Failed to setup shared iOS nodes:', error);
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
           this.silentAudio.load();
        }
        this.contextUnlocked = true;
        this.setupSharedIOSNodes();
        ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
          document.removeEventListener(event, unlock);
        });
        console.log('🔓 AudioContext unlocked');
      } catch (err) {
        console.error('Failed to unlock AudioContext:', err);
      }
    };
    ['click', 'touchstart', 'touchend', 'mousedown'].forEach(event => {
      document.addEventListener(event, unlock, { once: false, passive: true });
    });
  }

  // --- PRE-WARMING SYSTEM ---
  async preUnlockAudio(): Promise<void> {
    if (this.isPrewarmed) return;
    
    try {
      if (!this.audioContext) this.initializeAudioContext();
      
      if (this.audioContext?.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Play silent oscillator to warm up audio pipeline
      if (this.audioContext) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.001);
      }
      
      this.contextUnlocked = this.audioContext?.state === 'running';
      this.isPrewarmed = true;
      console.log('🔥 Audio system pre-warmed');
    } catch (error) {
      console.error('Pre-warm failed:', error);
    }
  }

  // --- iOS AudioBuffer decoding with memory management ---
  private getBufferSize(buffer: AudioBuffer): number {
    // Size = samples × channels × bytes per sample (Float32 = 4 bytes)
    return buffer.length * buffer.numberOfChannels * 4;
  }

  private evictOldestBuffers(neededBytes: number): void {
    if (!this.isIOS) return;
    
    // Sort by access time (oldest first)
    const entries = Array.from(this.bufferAccessTime.entries())
      .sort((a, b) => a[1] - b[1]);
    
    let freedBytes = 0;
    for (const [url] of entries) {
      if (this.bufferMemoryUsage + neededBytes - freedBytes <= IOS_MAX_BUFFER_MEMORY) {
        break;
      }
      
      const buffer = this.bufferCache.get(url);
      if (buffer) {
        const size = this.getBufferSize(buffer);
        this.bufferCache.delete(url);
        this.bufferAccessTime.delete(url);
        freedBytes += size;
        
        // Also clear from any instance using this URL
        this.audioInstances.forEach(inst => {
          if (inst.lastAudioUrl === url && !inst.isPlaying) {
            inst.audioBuffer = null;
          }
        });
        
        console.log(`🗑️ Evicted buffer: ${(size / 1024 / 1024).toFixed(2)}MB freed`);
      }
    }
    
    this.bufferMemoryUsage -= freedBytes;
  }

  private async decodeAudioBuffer(url: string): Promise<AudioBuffer | null> {
    if (!this.audioContext) return null;
    
    // Check cache first and update access time
    const cached = this.bufferCache.get(url);
    if (cached) {
      this.bufferAccessTime.set(url, Date.now());
      return cached;
    }
    
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      
      const bufferSize = this.getBufferSize(audioBuffer);
      
      // iOS memory management: evict old buffers if needed
      if (this.isIOS && this.bufferMemoryUsage + bufferSize > IOS_MAX_BUFFER_MEMORY) {
        this.evictOldestBuffers(bufferSize);
      }
      
      // Cache the decoded buffer with memory tracking
      this.bufferCache.set(url, audioBuffer);
      this.bufferAccessTime.set(url, Date.now());
      this.bufferMemoryUsage += bufferSize;
      
      if (this.isIOS) {
        console.log(`🎵 Buffer cached: ${(bufferSize / 1024 / 1024).toFixed(2)}MB (total: ${(this.bufferMemoryUsage / 1024 / 1024).toFixed(2)}MB)`);
      }
      
      return audioBuffer;
    } catch (error) {
      console.error('Failed to decode audio buffer:', error);
      return null;
    }
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
    if (!instance.audioElement && !instance.bufferSourceNode) return;

    try {
      instance.cleanupFunctions.forEach(cleanup => {
        try { cleanup(); } catch (e) { }
      });
      instance.cleanupFunctions = [];

      if (instance.audioElement) {
        instance.audioElement.pause();
        instance.audioElement.src = ''; 
        instance.audioElement.load(); 
      }

      if (instance.iosProgressInterval) {
        clearInterval(instance.iosProgressInterval);
        instance.iosProgressInterval = null;
      }

      this.disconnectAudioNodes(instance);
      
      instance.audioElement = null;
      instance.sourceNode = null;
      instance.bufferSourceNode = null;
      instance.isConnected = false;
      instance.sourceConnected = false;
    } catch (e) {
      console.error('Error dehydrating instance:', e);
    }
  }

  private ensureAudioResources(instance: AudioInstance): boolean {
    instance.lastUsedTime = Date.now();

    // For iOS with buffer, we don't need HTMLAudioElement
    if (this.isIOS && instance.audioBuffer) return true;
    
    if (instance.audioElement) return true;
    if (!instance.lastAudioUrl) return false;

    try {
      this.enforceAudioLimit();

      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.src = instance.lastAudioUrl;
      audio.muted = false;
      audio.volume = 1.0;
      // iOS: use 'none' preload since we use AudioBuffer
      audio.preload = this.isIOS ? 'none' : 'metadata';
      (audio as any).playsInline = true;
      audio.muted = false;
      audio.volume = 1.0;

      if ('preservesPitch' in audio && !this.isIOS) {
        (audio as any).preservesPitch = false;
      }

      audio.playbackRate = Math.pow(2, (instance.pitch || 0) / 12);
      audio.loop = instance.playbackMode === 'loop';

      instance.audioElement = audio;

      const handleTimeUpdate = () => {
        if (!instance.audioElement) return;
        const currentTime = instance.audioElement.currentTime * 1000;
        const duration = (instance.endTimeMs || instance.audioElement.duration * 1000) - (instance.startTimeMs || 0);
        const currentProgress = ((currentTime - (instance.startTimeMs || 0)) / duration) * 100;
        instance.progress = Math.max(0, Math.min(100, currentProgress));

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
          this.releaseChannel(instance);
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
      existing.ignoreChannel = !!padData.ignoreChannel;
      this.updatePadSettings(padId, {
        triggerMode: padData.triggerMode,
        playbackMode: padData.playbackMode,
        startTimeMs: padData.startTimeMs,
        endTimeMs: padData.endTimeMs,
        fadeInMs: padData.fadeInMs,
        fadeOutMs: padData.fadeOutMs,
        pitch: padData.pitch,
        ignoreChannel: padData.ignoreChannel
      });
      existing.lastUsedTime = Date.now(); 
      
      // iOS: Buffer will be decoded on-demand when pad is played (lazy loading)
      // This prevents memory overflow from decoding all samples upfront
      
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
      channelId: null,
      ignoreChannel: !!padData.ignoreChannel,
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
      lastUsedTime: Date.now(),
      // iOS buffer fields
      audioBuffer: null,
      bufferSourceNode: null,
      isBufferDecoding: false,
      bufferDuration: 0,
      iosProgressInterval: null
    };

    this.audioInstances.set(padId, instance);
    
    // iOS: Buffer will be decoded on-demand when pad is played (lazy loading)
    // This prevents memory overflow from decoding all samples upfront
    if (!this.isIOS) {
      this.ensureAudioResources(instance);
    }
    
    this.notifyStateChange();
  }

  // iOS: Start decoding audio buffer in background
  private async startBufferDecode(instance: AudioInstance) {
    if (!instance.lastAudioUrl || instance.isBufferDecoding || instance.audioBuffer) return;
    
    instance.isBufferDecoding = true;
    
    try {
      const buffer = await this.decodeAudioBuffer(instance.lastAudioUrl);
      if (buffer) {
        instance.audioBuffer = buffer;
        instance.bufferDuration = buffer.duration * 1000;
        if (instance.endTimeMs === 0) {
          instance.endTimeMs = instance.bufferDuration;
        }
        console.log(`🎵 Buffer decoded for ${instance.padName} (${(buffer.duration).toFixed(2)}s)`);
      }
    } catch (error) {
      console.error(`Failed to decode buffer for ${instance.padName}:`, error);
    } finally {
      instance.isBufferDecoding = false;
    }
  }

  private getBaseGain(instance: AudioInstance) {
    const channelVolume = instance.channelId ? (this.channelVolumes.get(instance.channelId) ?? 1) : 1;
    return this.globalMuted || instance.softMuted ? 0 : instance.volume * this.masterVolume * channelVolume;
  }

  private assignChannel(instance: AudioInstance): boolean {
    if (instance.ignoreChannel) {
      this.releaseChannel(instance);
      return true;
    }
    if (instance.channelId && this.channelAssignments.get(instance.channelId) === instance.padId) {
      return true;
    }
    if (instance.channelId && !this.channelAssignments.has(instance.channelId)) {
      this.channelAssignments.set(instance.channelId, instance.padId);
      return true;
    }
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      if (!this.channelAssignments.has(i)) {
        this.channelAssignments.set(i, instance.padId);
        instance.channelId = i;
        return true;
      }
    }
    return false;
  }

  private releaseChannel(instance: AudioInstance, keepChannel?: boolean) {
    if (keepChannel) return;
    if (instance.channelId && this.channelAssignments.get(instance.channelId) === instance.padId) {
      this.channelAssignments.delete(instance.channelId);
    }
    instance.channelId = null;
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
    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
      instance.iosProgressInterval = null;
    }
    if (instance.gainNode && this.audioContext) {
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
    // For iOS buffer playback, use interval-based monitoring
    if (this.isIOS && instance.bufferSourceNode) {
      this.startIOSFadeOutMonitor(instance);
      return;
    }
    
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

  // iOS-specific fade out monitor using intervals (more reliable than RAF on iOS)
  private startIOSFadeOutMonitor(instance: AudioInstance) {
    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
    }
    
    const startTime = performance.now();
    const startOffset = instance.startTimeMs || 0;
    const endMs = instance.endTimeMs || instance.bufferDuration;
    const totalDuration = endMs - startOffset;
    let lastNotifiedProgress = 0;
    
    // Use longer interval on iOS to reduce CPU usage (5 FPS vs 20 FPS)
    const updateInterval = this.isIOS ? 200 : (this.isAndroid ? 100 : 50);
    
    instance.iosProgressInterval = setInterval(() => {
      if (!instance.isPlaying) {
        if (instance.iosProgressInterval) {
          clearInterval(instance.iosProgressInterval);
          instance.iosProgressInterval = null;
        }
        return;
      }
      
      const elapsed = performance.now() - startTime;
      const pitchFactor = Math.pow(2, (instance.pitch || 0) / 12);
      const adjustedElapsed = elapsed * pitchFactor;
      
      // Update progress
      const newProgress = Math.min(100, (adjustedElapsed / totalDuration) * 100);
      instance.progress = newProgress;
      
      // Check for fade out
      const remainingMs = totalDuration - adjustedElapsed;
      if (instance.fadeOutMs > 0 && remainingMs <= instance.fadeOutMs && instance.fadeOutStartTime === null) {
        const currentGain = instance.gainNode ? instance.gainNode.gain.value : this.getBaseGain(instance);
        instance.fadeOutStartTime = performance.now();
        instance.isFading = true;
        this.startManualFade(instance, currentGain, 0, Math.max(0, remainingMs), () => {
          instance.fadeOutStartTime = null;
          instance.isFading = false;
        });
      }
      
      // Check for end
      if (adjustedElapsed >= totalDuration) {
        if (instance.playbackMode === 'loop') {
          // Restart for loop - handled by bufferSourceNode.loop
        } else {
          this.stopPad(instance.padId, 'instant');
        }
      }
      
      // Only notify on significant progress changes (every 5%) to reduce re-renders
      if (Math.abs(newProgress - lastNotifiedProgress) >= 5 || newProgress >= 100) {
        lastNotifiedProgress = newProgress;
        this.notifyStateChange();
      }
    }, updateInterval);
  }

  // iOS optimized: Audio graph with filter for stop effects (Source → Filter → Gain → SharedGain → Destination)
  private connectAudioNodesIOS(instance: AudioInstance) {
    if (!this.audioContext || !this.sharedIOSGainNode) return;
    
    try {
      // Create filter node for filter sweep stop mode
      if (!instance.filterNode) {
        instance.filterNode = this.audioContext.createBiquadFilter();
        instance.filterNode.type = 'lowpass';
        instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
        instance.filterNode.Q.setValueAtTime(1, this.audioContext.currentTime);
      }
      
      // Create per-instance gain node for individual volume control
      if (!instance.gainNode) {
        instance.gainNode = this.audioContext.createGain();
        // Connect: filter → gain → shared gain
        instance.filterNode.connect(instance.gainNode);
        instance.gainNode.connect(this.sharedIOSGainNode);
      }
      
      instance.isConnected = true;
      this.applyGlobalSettingsToInstance(instance);
    } catch (error) {
      console.error('Failed to connect iOS audio nodes:', error);
      instance.isConnected = false;
    }
  }

  private connectAudioNodes(instance: AudioInstance) {
    if (!this.audioContext || instance.isConnected || !instance.audioElement) return;

    // Use simplified iOS path
    if (this.isIOS) {
      this.connectAudioNodesIOS(instance);
      return;
    }

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

      if (instance.sourceNode) {
        instance.sourceNode.connect(instance.eqNodes.low!);
        instance.eqNodes.low!.connect(instance.eqNodes.mid!);
        instance.eqNodes.mid!.connect(instance.eqNodes.high!);
        instance.eqNodes.high!.connect(instance.filterNode!);
        instance.filterNode!.connect(instance.gainNode!);
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
      // Stop and disconnect buffer source
      if (instance.bufferSourceNode) {
        try {
          instance.bufferSourceNode.stop();
          instance.bufferSourceNode.disconnect();
        } catch (e) { }
        instance.bufferSourceNode = null;
      }
      
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

    instance.lastUsedTime = Date.now();

    if (!this.assignChannel(instance)) {
      console.warn('No available playback channels. Playback blocked for:', padId);
      return;
    }

    // iOS: Use buffer-based playback for instant response
    if (this.isIOS) {
      this.playPadIOS(instance);
      return;
    }

    const isReady = this.ensureAudioResources(instance);
    if (!isReady) {
      console.error('Could not allocate audio resource for pad:', padId);
      this.releaseChannel(instance);
      return;
    }

    if (!this.contextUnlocked && this.audioContext) {
      const tryResume = this.audioContext.state === 'suspended' ? this.audioContext.resume() : Promise.resolve();
      const trySilent = this.silentAudio ? this.silentAudio.play().catch(() => {}) : Promise.resolve();
      
      Promise.all([tryResume, trySilent]).then(() => {
        this.contextUnlocked = !!this.audioContext && this.audioContext.state === 'running';
        this.proceedWithPlay(instance);
      });
      return; 
    }

    this.proceedWithPlay(instance);
  }

  // iOS optimized playback using AudioBufferSourceNode
  private playPadIOS(instance: AudioInstance): void {
    if (!this.audioContext) {
      console.error('No AudioContext for iOS playback');
      return;
    }

    // Ensure context is unlocked
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => this.playPadIOSInternal(instance));
      return;
    }

    this.playPadIOSInternal(instance);
  }

  private playPadIOSInternal(instance: AudioInstance): void {
    if (!this.audioContext || !this.sharedIOSGainNode) return;

    // If buffer is still decoding, wait briefly then try again
    if (instance.isBufferDecoding) {
      setTimeout(() => this.playPadIOSInternal(instance), 50);
      return;
    }

    // If no buffer, try to decode now or fall back to MediaElement
    if (!instance.audioBuffer) {
      if (instance.lastAudioUrl) {
        this.startBufferDecode(instance);
        // Fall back to MediaElement while buffer decodes
        this.ensureAudioResources(instance);
        if (instance.audioElement) {
          this.proceedWithPlay(instance);
        }
      }
      return;
    }

    this._applyNextPlayOverrides(instance);

    // Handle unmute trigger mode
    if (instance.triggerMode === 'unmute' && instance.isPlaying) {
      instance.softMuted = !instance.softMuted;
      const targetGain = this.getBaseGain(instance);
      this.setGain(instance, targetGain);
      this.notifyStateChange();
      return;
    }

    // Stopper mode: stop all other pads
    if (instance.playbackMode === 'stopper') {
      this.audioInstances.forEach(other => {
        if (other.padId !== instance.padId && other.isPlaying) this.stopPad(other.padId, 'instant');
      });
    }

    // Stop any existing playback
    this.stopFadeAutomation(instance);
    if (instance.bufferSourceNode) {
      try {
        instance.bufferSourceNode.stop();
        instance.bufferSourceNode.disconnect();
      } catch (e) { }
    }

    // Ensure audio nodes are connected
    if (!instance.isConnected) {
      this.connectAudioNodesIOS(instance);
    }

    // Create new buffer source
    const source = this.audioContext.createBufferSource();
    source.buffer = instance.audioBuffer;
    source.loop = instance.playbackMode === 'loop';
    source.playbackRate.setValueAtTime(Math.pow(2, (instance.pitch || 0) / 12), this.audioContext.currentTime);

    // Reset filter to transparent state before playing
    if (instance.filterNode) {
      instance.filterNode.frequency.cancelScheduledValues(this.audioContext.currentTime);
      instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
    }

    // Connect: source → filter → gain → shared gain → destination
    source.connect(instance.filterNode || instance.gainNode!);
    instance.bufferSourceNode = source;

    // Setup fade in
    const baseGain = this.getBaseGain(instance);
    const initialGain = instance.fadeInMs > 0 ? 0 : baseGain;
    this.setGain(instance, initialGain);

    // Calculate start offset and duration
    const startOffset = (instance.startTimeMs || 0) / 1000;
    const endTime = instance.endTimeMs > 0 ? instance.endTimeMs / 1000 : instance.audioBuffer.duration;
    const duration = endTime - startOffset;

    // Handle playback end
    source.onended = () => {
      if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
        instance.isPlaying = false;
        instance.progress = 0;
        instance.isFading = false;
        if (instance.iosProgressInterval) {
          clearInterval(instance.iosProgressInterval);
          instance.iosProgressInterval = null;
        }
        this.releaseChannel(instance);
        this.notifyStateChange();
      }
    };

    // Start playback
    try {
      if (instance.playbackMode === 'loop') {
        source.loopStart = startOffset;
        source.loopEnd = endTime;
        source.start(0, startOffset);
      } else {
        source.start(0, startOffset, duration);
      }

      instance.isPlaying = true;
      instance.playStartTime = Date.now();
      instance.isFading = instance.fadeInMs > 0;
      instance.progress = 0;

      // Apply fade in
      if (instance.fadeInMs > 0) {
        this.startManualFade(instance, initialGain, baseGain, instance.fadeInMs, () => {
          instance.fadeInStartTime = null;
          instance.isFading = false;
        });
      }

      // Start progress/fade-out monitoring
      this.startIOSFadeOutMonitor(instance);

      console.log(`▶️ iOS buffer play: ${instance.padName}`);
      this.notifyStateChange();
    } catch (error) {
      console.error('Failed to play iOS buffer:', error);
    }
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

    this.stopFadeAutomation(instance);
    instance.fadeInStartTime = instance.fadeInMs > 0 ? performance.now() : null;
    instance.fadeOutStartTime = null;

    const baseGainBeforePlay = this.getBaseGain(instance);
    const initialGainBeforePlay = instance.fadeInMs > 0 ? 0 : baseGainBeforePlay;
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

  private stopPadInstant(instance: AudioInstance, keepChannel?: boolean): void {
    // Stop buffer source for iOS
    if (instance.bufferSourceNode) {
      try {
        instance.bufferSourceNode.stop();
        instance.bufferSourceNode.disconnect();
      } catch (e) { }
      instance.bufferSourceNode = null;
    }
    
    if (instance.iosProgressInterval) {
      clearInterval(instance.iosProgressInterval);
      instance.iosProgressInterval = null;
    }

    if (instance.audioElement) {
      instance.audioElement.pause();
      instance.audioElement.currentTime = (instance.startTimeMs || 0) / 1000;
    }

    instance.isPlaying = false;
    instance.progress = 0;
    instance.isFading = false;
    instance.fadeInStartTime = null;
    instance.fadeOutStartTime = null;
    instance.playStartTime = null;
    this.releaseChannel(instance, keepChannel);

    if (!this.isIOS) this.disconnectAudioNodes(instance);
    this.stopFadeAutomation(instance);
    this.resetInstanceAudio(instance);
    this.notifyStateChange();
  }

  private stopPadFadeout(instance: AudioInstance): void {
    if (!instance.audioElement && !instance.bufferSourceNode) { this.stopPadInstant(instance); return; }
    this.stopFadeAutomation(instance);
    instance.isFading = true;
    const durationMs = instance.fadeOutMs > 0 ? instance.fadeOutMs : 1000;
    this.applyManualFadeOut(instance, () => this.stopPadInstant(instance), durationMs);
  }

  private stopPadBrake(instance: AudioInstance): void {
    // iOS buffer playback: Use AudioParam automation for brake effect
    if (this.isIOS && instance.bufferSourceNode && this.audioContext) {
      instance.isFading = true;
      const currentRate = instance.bufferSourceNode.playbackRate.value;
      const duration = 1.5; // 1.5 second brake
      
      // Gradually slow down to near-stop
      instance.bufferSourceNode.playbackRate.cancelScheduledValues(this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.setValueAtTime(currentRate, this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.linearRampToValueAtTime(0.05, this.audioContext.currentTime + duration);
      
      // Also fade out the volume
      if (instance.gainNode) {
        const currentGain = instance.gainNode.gain.value;
        instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        instance.gainNode.gain.setValueAtTime(currentGain, this.audioContext.currentTime);
        instance.gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + duration);
      }
      
      // Stop after brake completes
      setTimeout(() => {
        this.stopPadInstant(instance);
      }, duration * 1000);
      return;
    }
    
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
    // iOS buffer playback: Use AudioParam automation for backspin effect
    if (this.isIOS && instance.bufferSourceNode && this.audioContext) {
      instance.isFading = true;
      const currentRate = instance.bufferSourceNode.playbackRate.value;
      const speedUpDuration = 0.5; // Speed up for 0.5s
      const fadeOutDuration = 0.5; // Then fade out for 0.5s
      const totalDuration = speedUpDuration + fadeOutDuration;
      
      // Speed up to 3x
      instance.bufferSourceNode.playbackRate.cancelScheduledValues(this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.setValueAtTime(currentRate, this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.linearRampToValueAtTime(3, this.audioContext.currentTime + speedUpDuration);
      
      // Fade out volume during the second half
      if (instance.gainNode) {
        const currentGain = instance.gainNode.gain.value;
        instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        instance.gainNode.gain.setValueAtTime(currentGain, this.audioContext.currentTime);
        // Keep volume for speed up phase, then fade out
        instance.gainNode.gain.setValueAtTime(currentGain, this.audioContext.currentTime + speedUpDuration);
        instance.gainNode.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + totalDuration);
      }
      
      // Stop after backspin completes
      setTimeout(() => {
        this.stopPadInstant(instance);
      }, totalDuration * 1000);
      return;
    }
    
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
    
    // Apply filter sweep: 20kHz → 100Hz
    instance.filterNode.frequency.cancelScheduledValues(this.audioContext.currentTime);
    instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
    instance.filterNode.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + duration);

    setTimeout(() => {
      if (instance.isPlaying) this.stopPadInstant(instance);
      // Reset filter to transparent
      if (instance.filterNode && this.audioContext) {
        instance.filterNode.frequency.cancelScheduledValues(this.audioContext.currentTime);
        instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
      }
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
    if (!instance.isConnected || !instance.gainNode || !this.audioContext) return;
    if (instance.isFading || instance.fadeInStartTime || instance.fadeOutStartTime) return;
    const targetVolume = this.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
    instance.gainNode.gain.setValueAtTime(targetVolume, this.audioContext.currentTime);
  }

  private applySoftMute(instance: AudioInstance): void {
    if (!instance.gainNode || !this.audioContext) return;
    // Cancel fades so soft-mute takes immediate effect
    this.stopFadeAutomation(instance);
    const targetVolume = this.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
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
    }, NOTIFICATION_THROTTLE_MS);
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

    if (typeof o.padName === 'string') instance.padName = o.padName;
    if (typeof o.name === 'string') instance.padName = o.name;
    if (typeof o.color === 'string') instance.color = o.color;
    if (typeof o.bankId === 'string') instance.bankId = o.bankId;
    if (typeof o.bankName === 'string') instance.bankName = o.bankName;
    
    if (typeof o.triggerMode !== 'undefined') instance.triggerMode = o.triggerMode;
    if (typeof o.playbackMode !== 'undefined') {
      instance.playbackMode = o.playbackMode;
      if (instance.audioElement) instance.audioElement.loop = o.playbackMode === 'loop';
    }
    
    if (typeof o.startTimeMs === 'number') instance.startTimeMs = Math.max(0, o.startTimeMs);
    if (typeof o.endTimeMs === 'number') instance.endTimeMs = Math.max(0, o.endTimeMs);
    if (typeof o.fadeInMs === 'number') instance.fadeInMs = Math.max(0, o.fadeInMs);
    if (typeof o.fadeOutMs === 'number') instance.fadeOutMs = Math.max(0, o.fadeOutMs);
    if (typeof o.pitch === 'number') instance.pitch = o.pitch;
    if (typeof o.volume === 'number') instance.volume = o.volume;

    instance.nextPlayOverrides = undefined;
  }

  stopPad(padId: string, mode: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter' = 'instant', keepChannel?: boolean): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.fadeIntervalId) { clearInterval(instance.fadeIntervalId); instance.fadeIntervalId = null; }
    switch (mode) {
      case 'instant': this.stopPadInstant(instance, keepChannel); break;
      case 'fadeout': this.stopPadFadeout(instance); break;
      case 'brake': this.stopPadBrake(instance); break;
      case 'backspin': this.stopPadBackspin(instance); break;
      case 'filter': this.stopPadFilter(instance); break;
    }
  }

  unregisterPad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    this.releaseChannel(instance);
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
      if (instance.bufferSourceNode && this.audioContext) {
        instance.bufferSourceNode.playbackRate.setValueAtTime(Math.pow(2, settings.pitch / 12), this.audioContext.currentTime);
      }
    }
    if (settings.volume !== undefined) {
      instance.volume = settings.volume;
      this.updateInstanceVolume(instance);
    }
    if (settings.ignoreChannel !== undefined) {
      instance.ignoreChannel = settings.ignoreChannel;
      if (settings.ignoreChannel) {
        this.releaseChannel(instance);
        this.updateInstanceVolume(instance);
        this.notifyStateChange();
      } else if (instance.isPlaying && !instance.channelId) {
        this.assignChannel(instance);
        this.updateInstanceVolume(instance);
        this.notifyStateChange();
      }
    }
    
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
          if (instance.isPlaying) {
              let currentRelMs = 0;
              let endRelMs = 0;
              
              if (instance.audioElement) {
                  const nowAbsMs = instance.audioElement.currentTime * 1000;
                  const regionStart = instance.startTimeMs || 0;
                  const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
                  currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
                  endRelMs = Math.max(0, regionEnd - regionStart);
              } else if (instance.bufferSourceNode && instance.playStartTime) {
                  // For buffer-based playback, calculate from playStartTime
                  const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
                  const regionStart = instance.startTimeMs || 0;
                  const regionEnd = instance.endTimeMs || instance.bufferDuration;
                  currentRelMs = Math.min(elapsed, regionEnd - regionStart);
                  endRelMs = regionEnd - regionStart;
              }
              
              const factor = this.computeEffectiveVolumeFactor(instance);
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
                  playStartTime: instance.playStartTime || 0,
                  channelId: instance.channelId ?? null
              });
          }
      });
      return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
  }

  getLegacyPlayingPads() {
      const playing: any[] = [];
      this.audioInstances.forEach(instance => {
          if (instance.isPlaying && instance.ignoreChannel) {
              let currentRelMs = 0;
              let endRelMs = 0;

              if (instance.audioElement) {
                  const nowAbsMs = instance.audioElement.currentTime * 1000;
                  const regionStart = instance.startTimeMs || 0;
                  const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
                  currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
                  endRelMs = Math.max(0, regionEnd - regionStart);
              } else if (instance.bufferSourceNode && instance.playStartTime) {
                  const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
                  const regionStart = instance.startTimeMs || 0;
                  const regionEnd = instance.endTimeMs || instance.bufferDuration;
                  currentRelMs = Math.min(elapsed, regionEnd - regionStart);
                  endRelMs = regionEnd - regionStart;
              }

              playing.push({
                  padId: instance.padId,
                  padName: instance.padName,
                  bankId: instance.bankId,
                  bankName: instance.bankName,
                  color: instance.color,
                  volume: instance.volume,
                  currentMs: currentRelMs,
                  endMs: endRelMs,
                  playStartTime: instance.playStartTime || 0
              });
          }
      });
      return playing.sort((a, b) => (a.playStartTime || 0) - (b.playStartTime || 0));
  }

  getChannelStates() {
    const channels: any[] = [];
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      const padId = this.channelAssignments.get(i);
      let pad = null;
      if (padId) {
        const instance = this.audioInstances.get(padId);
        if (instance && instance.isPlaying) {
          let currentRelMs = 0;
          let endRelMs = 0;
          if (instance.audioElement) {
            const nowAbsMs = instance.audioElement.currentTime * 1000;
            const regionStart = instance.startTimeMs || 0;
            const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.audioElement.duration * 1000;
            currentRelMs = Math.max(0, Math.min(regionEnd - regionStart, nowAbsMs - regionStart));
            endRelMs = Math.max(0, regionEnd - regionStart);
          } else if (instance.bufferSourceNode && instance.playStartTime) {
            const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
            const regionStart = instance.startTimeMs || 0;
            const regionEnd = instance.endTimeMs || instance.bufferDuration;
            currentRelMs = Math.min(elapsed, regionEnd - regionStart);
            endRelMs = regionEnd - regionStart;
          }
          const factor = this.computeEffectiveVolumeFactor(instance);
          pad = {
            padId: instance.padId,
            padName: instance.padName,
            bankId: instance.bankId,
            bankName: instance.bankName,
            color: instance.color,
            volume: instance.volume,
            effectiveVolume: instance.volume * factor,
            currentMs: currentRelMs,
            endMs: endRelMs,
            playStartTime: instance.playStartTime || 0,
            channelId: instance.channelId ?? null
          };
        }
      }
      channels.push({
        channelId: i,
        channelVolume: this.channelVolumes.get(i) ?? 1,
        pad
      });
    }
    return channels;
  }

  setChannelVolume(channelId: number, volume: number) {
    const safe = Math.max(0, Math.min(1, volume));
    this.channelVolumes.set(channelId, safe);
    const padId = this.channelAssignments.get(channelId);
    if (padId) {
      const instance = this.audioInstances.get(padId);
      if (instance) {
        this.updateInstanceVolume(instance);
      }
    }
    this.notifyStateChange();
  }

  getChannelVolume(channelId: number) {
    return this.channelVolumes.get(channelId) ?? 1;
  }

  stopChannel(channelId: number) {
    const padId = this.channelAssignments.get(channelId);
    if (padId) {
      this.stopPad(padId, 'instant');
    }
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
    // Update shared iOS gain node
    if (this.sharedIOSGainNode && this.audioContext) {
      this.sharedIOSGainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
    }
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
  
  triggerToggle(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.isPlaying) {
      this.stopPad(padId, 'instant');
    } else {
      instance.softMuted = false;
      this.playPad(padId);
    }
  }

  triggerHoldStart(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.playPad(padId);
    }
  }

  triggerHoldStop(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (instance.isPlaying) {
      this.stopPad(padId, 'instant');
    }
  }

  triggerStutter(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.playPad(padId);
      return;
    }
    this.stopPad(padId, 'instant', true);
    setTimeout(() => { this.playPad(padId); }, 5);
  }

  triggerUnmuteToggle(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    if (!instance.isPlaying) {
      instance.softMuted = false;
      this.playPad(padId);
      return;
    }
    instance.softMuted = !instance.softMuted;
    this.applySoftMute(instance);
    this.notifyStateChange();
  }

  toggleMutePad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;
    // For buffer-based, toggle soft mute
    instance.softMuted = !instance.softMuted;
    this.applySoftMute(instance);
    this.notifyStateChange();
  }
  
  // --- DIAGNOSTIC METHODS ---
  
  getDebugInfo() { 
    return { 
      totalInstances: this.audioInstances.size, 
      activeElements: Array.from(this.audioInstances.values()).filter(i => i.audioElement).length,
      activeBuffers: Array.from(this.audioInstances.values()).filter(i => i.audioBuffer).length,
      playingCount: Array.from(this.audioInstances.values()).filter(i => i.isPlaying).length,
      isIOS: this.isIOS,
      contextState: this.audioContext?.state || 'none',
      isUnlocked: this.contextUnlocked
    }; 
  }
  
  getIOSDebugInfo() { 
    return {
      isIOS: this.isIOS,
      contextState: this.audioContext?.state || 'none',
      isUnlocked: this.contextUnlocked,
      hasSharedGain: !!this.sharedIOSGainNode,
      bufferCacheSize: this.bufferCache.size,
      isPrewarmed: this.isPrewarmed
    }; 
  }
  
  forceIOSUnlock() { 
    if (this.iosAudioService) {
      return this.iosAudioService.forceUnlock();
    }
    return this.preUnlockAudio().then(() => this.contextUnlocked);
  }

  getAudioState(): AudioSystemState {
    return {
      isIOS: this.isIOS,
      contextState: this.audioContext?.state || 'none',
      isUnlocked: this.contextUnlocked,
      totalInstances: this.audioInstances.size,
      playingCount: Array.from(this.audioInstances.values()).filter(i => i.isPlaying).length,
      bufferedCount: Array.from(this.audioInstances.values()).filter(i => i.audioBuffer).length,
      masterVolume: this.masterVolume,
      globalMuted: this.globalMuted
    };
  }

  async runDiagnostics(): Promise<DiagnosticResult> {
    const result: DiagnosticResult = {
      contextState: this.audioContext?.state || 'none',
      isUnlocked: this.contextUnlocked,
      isIOS: this.isIOS,
      silentAudioTest: { success: false, latencyMs: 0 },
      oscillatorTest: { success: false, latencyMs: 0 },
      bufferTest: { success: false, latencyMs: 0 },
      mediaElementTest: { success: false, latencyMs: 0 },
      totalInstances: this.audioInstances.size,
      activeBuffers: this.bufferCache.size
    };

    if (!this.audioContext) {
      return result;
    }

    // Test 1: Silent audio (context resume)
    try {
      const start1 = performance.now();
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      result.silentAudioTest = { 
        success: this.audioContext.state === 'running', 
        latencyMs: performance.now() - start1 
      };
    } catch (e) {
      result.silentAudioTest = { success: false, latencyMs: 0 };
    }

    // Test 2: Oscillator
    try {
      const start2 = performance.now();
      const osc = this.audioContext.createOscillator();
      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
      osc.connect(gain);
      gain.connect(this.audioContext.destination);
      osc.start();
      osc.stop(this.audioContext.currentTime + 0.1);
      result.oscillatorTest = { success: true, latencyMs: performance.now() - start2 };
    } catch (e) {
      result.oscillatorTest = { success: false, latencyMs: 0 };
    }

    // Test 3: AudioBuffer
    try {
      const start3 = performance.now();
      // Create a simple test buffer (1 second of silence)
      const testBuffer = this.audioContext.createBuffer(1, 44100, 44100);
      const source = this.audioContext.createBufferSource();
      source.buffer = testBuffer;
      const gain = this.audioContext.createGain();
      gain.gain.setValueAtTime(0.01, this.audioContext.currentTime);
      source.connect(gain);
      gain.connect(this.audioContext.destination);
      source.start();
      source.stop(this.audioContext.currentTime + 0.05);
      result.bufferTest = { success: true, latencyMs: performance.now() - start3 };
    } catch (e) {
      result.bufferTest = { success: false, latencyMs: 0 };
    }

    // Test 4: Media Element (skip on iOS to avoid issues)
    if (!this.isIOS) {
      try {
        const start4 = performance.now();
        const audio = new Audio();
        audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        audio.volume = 0.01;
        await audio.play();
        audio.pause();
        result.mediaElementTest = { success: true, latencyMs: performance.now() - start4 };
      } catch (e) {
        result.mediaElementTest = { success: false, latencyMs: 0 };
      }
    } else {
      result.mediaElementTest = { success: true, latencyMs: 0 }; // Skip on iOS
    }

    return result;
  }
}

const globalPlaybackManager = new GlobalPlaybackManagerClass();

// Expose for debugging
if (typeof window !== 'undefined') {
  (window as any).debugPlaybackManager = () => globalPlaybackManager.getDebugInfo();
  (window as any).debugIOSAudio = () => globalPlaybackManager.getIOSDebugInfo();
  (window as any).runAudioDiagnostics = () => globalPlaybackManager.runDiagnostics();
}

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
    stopPad: (padId: string, mode?: 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter', keepChannel?: boolean) =>
      globalPlaybackManager.stopPad(padId, mode, keepChannel),
    togglePad: (padId: string) =>
      globalPlaybackManager.togglePad(padId),
    triggerToggle: (padId: string) =>
      globalPlaybackManager.triggerToggle(padId),
    triggerHoldStart: (padId: string) =>
      globalPlaybackManager.triggerHoldStart(padId),
    triggerHoldStop: (padId: string) =>
      globalPlaybackManager.triggerHoldStop(padId),
    triggerStutter: (padId: string) =>
      globalPlaybackManager.triggerStutter(padId),
    triggerUnmuteToggle: (padId: string) =>
      globalPlaybackManager.triggerUnmuteToggle(padId),
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
    getLegacyPlayingPads: () =>
      globalPlaybackManager.getLegacyPlayingPads(),
    getChannelStates: () =>
      globalPlaybackManager.getChannelStates(),
    setChannelVolume: (channelId: number, volume: number) =>
      globalPlaybackManager.setChannelVolume(channelId, volume),
    getChannelVolume: (channelId: number) =>
      globalPlaybackManager.getChannelVolume(channelId),
    stopChannel: (channelId: number) =>
      globalPlaybackManager.stopChannel(channelId),
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
      globalPlaybackManager.preUnlockAudio(),
    runDiagnostics: () =>
      globalPlaybackManager.runDiagnostics(),
    getAudioState: () =>
      globalPlaybackManager.getAudioState()
  };
}
