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
  stopEffectTimeoutId: NodeJS.Timeout | null;
  playToken: number;
  pendingDecodePlayToken: number | null;
  reversedBackspinBuffer: AudioBuffer | null;
}

interface EqSettings {
  low: number;
  mid: number;
  high: number;
}

interface StopTimingProfile {
  instantStopFadeSec: number;
  instantStopFinalizeDelayMs: number;
  defaultFadeOutMs: number;
  brakeDurationSec: number;
  brakeMinRate: number;
  brakeWebDurationMs: number;
  backspinIOSPitchStart: number;
  backspinIOSPitchEnd: number;
  backspinIOSPitchRampSec: number;
  backspinIOSDurationSec: number;
  backspinWebSpeedUpMs: number;
  backspinWebTotalMs: number;
  backspinWebMaxRate: number;
  backspinWebMinRate: number;
  filterDurationSec: number;
  filterEndHz: number;
  volumeSmoothingSec: number;
  softMuteSmoothingSec: number;
  masterSmoothingSec: number;
}

type StopMode = 'instant' | 'fadeout' | 'brake' | 'backspin' | 'filter';
type HotcueTuple = [number | null, number | null, number | null, number | null];

interface DeckLoadedPadRef {
  bankId: string;
  padId: string;
}

interface DeckPadSnapshot {
  padId: string;
  padName: string;
  bankId: string;
  bankName: string;
  color: string;
  audioUrl: string;
  volume: number;
  startTimeMs: number;
  endTimeMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  pitch: number;
  playbackMode: 'once' | 'loop' | 'stopper';
  savedHotcuesMs: HotcueTuple;
}

interface DeckChannelRuntime {
  channelId: number;
  channelVolume: number;
  loadedPadRef: DeckLoadedPadRef | null;
  pad: DeckPadSnapshot | null;
  audioElement: HTMLAudioElement | null;
  sourceNode: MediaElementAudioSourceNode | null;
  sourceConnected: boolean;
  gainNode: GainNode | null;
  eqNodes: { low: BiquadFilterNode | null; mid: BiquadFilterNode | null; high: BiquadFilterNode | null };
  graphConnected: boolean;
  pendingInitialSeekSec: number | null;
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  hasLocalHotcueOverride: boolean;
  collapsed: boolean;
  waveformKey: string | null;
}

interface DeckChannelState {
  channelId: number;
  channelVolume: number;
  loadedPadRef: DeckLoadedPadRef | null;
  isPlaying: boolean;
  isPaused: boolean;
  playheadMs: number;
  durationMs: number;
  hotcuesMs: HotcueTuple;
  hasLocalHotcueOverride: boolean;
  collapsed: boolean;
  waveformKey: string | null;
  pad: {
    padId: string;
    padName: string;
    bankId: string;
    bankName: string;
    audioUrl?: string;
    color: string;
    volume: number;
    effectiveVolume: number;
    currentMs: number;
    endMs: number;
    playStartTime: number;
    channelId?: number | null;
  } | null;
}

interface GlobalPlaybackManager {
  registerPad: (padId: string, padData: any, bankId: string, bankName: string) => Promise<void>;
  unregisterPad: (padId: string) => void;
  playPad: (padId: string) => void;
  stopPad: (padId: string, mode?: StopMode, keepChannel?: boolean) => void;
  togglePad: (padId: string) => void;
  triggerToggle: (padId: string) => void;
  triggerHoldStart: (padId: string) => void;
  triggerHoldStop: (padId: string) => void;
  triggerStutter: (padId: string) => void;
  triggerUnmuteToggle: (padId: string) => void;
  updatePadSettings: (padId: string, settings: any) => void;
  updatePadSettingsNextPlay: (padId: string, settings: any) => void;
  updatePadMetadata: (padId: string, metadata: { name?: string; color?: string; bankId?: string; bankName?: string }) => void;
  getPadState: (padId: string) => { isPlaying: boolean; progress: number; effectiveVolume: number } | null;
  getAllPlayingPads: () => { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; currentMs: number; endMs: number; playStartTime: number; channelId?: number | null }[];
  getLegacyPlayingPads: () => { padId: string; padName: string; bankId: string; bankName: string; color: string; volume: number; currentMs: number; endMs: number; playStartTime: number }[];
  getChannelStates: () => DeckChannelState[];
  getDeckChannelStates: () => DeckChannelState[];
  loadPadToChannel: (channelId: number, padId: string) => boolean;
  unloadChannel: (channelId: number) => void;
  playChannel: (channelId: number) => void;
  pauseChannel: (channelId: number) => void;
  seekChannel: (channelId: number, ms: number) => void;
  setChannelHotcue: (channelId: number, slotIndex: number, ms: number | null) => void;
  clearChannelHotcue: (channelId: number, slotIndex: number) => void;
  triggerChannelHotcue: (channelId: number, slotIndex: number) => void;
  setChannelCollapsed: (channelId: number, collapsed: boolean) => void;
  setChannelCount: (count: number) => void;
  getChannelCount: () => number;
  resetDeckPlaybackToStart: () => void;
  hydrateDeckLayout: (deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number }>) => void;
  persistDeckLayoutSnapshot: () => Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs: HotcueTuple; collapsed: boolean; channelVolume: number }>;
  saveChannelHotcuesToPad: (channelId: number) => { ok: boolean; padId?: string };
  setChannelVolume: (channelId: number, volume: number) => void;
  getChannelVolume: (channelId: number) => number;
  stopChannel: (channelId: number, mode?: StopMode) => void;
  stopAllPads: (mode?: StopMode) => void;
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
  private registeredPads: Map<string, DeckPadSnapshot> = new Map();
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
  private deckChannels: Map<number, DeckChannelRuntime> = new Map();
  private deckChannelCount: number = 4;
  private waveformCacheRefs: Map<string, number> = new Map();
  private deckPlaybackRafId: number | null = null;
  // Pre-warming state
  private isPrewarmed: boolean = false;
  // Audio buffer cache for iOS with memory tracking
  private bufferCache: Map<string, AudioBuffer> = new Map();
  private bufferMemoryUsage: number = 0;
  private bufferAccessTime: Map<string, number> = new Map();
  private masterVolumeRafId: number | null = null;
  private pendingMasterVolume: number | null = null;
  private eqRafId: number | null = null;
  private pendingGlobalEQ: EqSettings | null = null;
  private foregroundUnlockTimeout: NodeJS.Timeout | null = null;

  private hasUserActivation(): boolean {
    const nav = navigator as Navigator & {
      userActivation?: {
        isActive?: boolean;
        hasBeenActive?: boolean;
      };
    };
    return Boolean(nav.userActivation?.isActive || nav.userActivation?.hasBeenActive);
  }

  constructor() {
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    this.isAndroid = /Android/.test(navigator.userAgent);
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      this.ensureDeckChannelRuntime(i);
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

    const handleForeground = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (this.foregroundUnlockTimeout) {
        clearTimeout(this.foregroundUnlockTimeout);
      }
      this.foregroundUnlockTimeout = setTimeout(() => {
        if (!this.contextUnlocked && !this.hasUserActivation()) {
          return;
        }
        this.preUnlockAudio().catch((error) => {
          console.warn('Foreground audio restore failed:', error);
        });
      }, 60);
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleForeground);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleForeground);
      window.addEventListener('pageshow', handleForeground);
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
      for (let i = 1; i <= this.deckChannelCount; i += 1) {
        const channel = this.getDeckChannel(i);
        if (channel?.audioElement) this.ensureDeckChannelAudioGraph(channel);
      }
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
    try {
      if (!this.audioContext) this.initializeAudioContext();
      
      if (this.audioContext?.state === 'suspended') {
        if (!this.contextUnlocked && !this.hasUserActivation()) {
          return;
        }
        await this.audioContext.resume();
      }

      if (this.isIOS && this.iosAudioService && !this.iosAudioService.isUnlocked()) {
        try {
          await this.iosAudioService.forceUnlock();
        } catch (error) {
          console.warn('iOS force unlock failed:', error);
        }
      }
      
      // Play silent oscillator to warm up audio pipeline
      if (this.audioContext && !this.isPrewarmed) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        osc.connect(gain);
        gain.connect(this.audioContext.destination);
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.001);
        this.isPrewarmed = true;
      }
      
      this.contextUnlocked = this.audioContext?.state === 'running';
      console.log('🔥 Audio system pre-warmed');
    } catch (error) {
      if (String((error as Error)?.name || '').toLowerCase() === 'notallowederror') {
        return;
      }
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
      if (typeof existing.playToken !== 'number') existing.playToken = 0;
      if (existing.pendingDecodePlayToken === undefined) existing.pendingDecodePlayToken = null;
      if (existing.reversedBackspinBuffer === undefined) existing.reversedBackspinBuffer = null;
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
      this.registeredPads.set(padId, {
        padId,
        padName: padData.name,
        bankId,
        bankName,
        color: padData.color,
        audioUrl: padData.audioUrl,
        volume: typeof padData.volume === 'number' ? padData.volume : 1,
        startTimeMs: typeof padData.startTimeMs === 'number' ? padData.startTimeMs : 0,
        endTimeMs: typeof padData.endTimeMs === 'number' ? padData.endTimeMs : 0,
        fadeInMs: typeof padData.fadeInMs === 'number' ? padData.fadeInMs : 0,
        fadeOutMs: typeof padData.fadeOutMs === 'number' ? padData.fadeOutMs : 0,
        pitch: typeof padData.pitch === 'number' ? padData.pitch : 0,
        playbackMode: padData.playbackMode === 'loop' ? 'loop' : padData.playbackMode === 'stopper' ? 'stopper' : 'once',
        savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
          ? (padData.savedHotcuesMs.slice(0, 4) as HotcueTuple)
          : [null, null, null, null]
      });
      
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
      iosProgressInterval: null,
      stopEffectTimeoutId: null,
      playToken: 0,
      pendingDecodePlayToken: null,
      reversedBackspinBuffer: null
    };

    this.audioInstances.set(padId, instance);
    this.registeredPads.set(padId, {
      padId,
      padName: padData.name,
      bankId,
      bankName,
      color: padData.color,
      audioUrl: padData.audioUrl,
      volume: typeof padData.volume === 'number' ? padData.volume : 1,
      startTimeMs: typeof padData.startTimeMs === 'number' ? padData.startTimeMs : 0,
      endTimeMs: typeof padData.endTimeMs === 'number' ? padData.endTimeMs : 0,
      fadeInMs: typeof padData.fadeInMs === 'number' ? padData.fadeInMs : 0,
      fadeOutMs: typeof padData.fadeOutMs === 'number' ? padData.fadeOutMs : 0,
      pitch: typeof padData.pitch === 'number' ? padData.pitch : 0,
      playbackMode: padData.playbackMode === 'loop' ? 'loop' : padData.playbackMode === 'stopper' ? 'stopper' : 'once',
      savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
        ? (padData.savedHotcuesMs.slice(0, 4) as HotcueTuple)
        : [null, null, null, null]
    });
    
    // iOS: Buffer will be decoded on-demand when pad is played (lazy loading)
    // This prevents memory overflow from decoding all samples upfront
    if (!this.isIOS) {
      this.ensureAudioResources(instance);
    } else if (this.audioInstances.size <= 12) {
      // Pre-decode a small pool to reduce first-play latency on iOS.
      void this.startBufferDecode(instance);
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
        instance.reversedBackspinBuffer = null;
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
    if (this.globalMuted || instance.softMuted) return 0;
    if (this.isIOS && this.sharedIOSGainNode) {
      return instance.volume * channelVolume;
    }
    return instance.volume * this.masterVolume * channelVolume;
  }

  private getStopTimingProfile(): StopTimingProfile {
    if (this.isIOS) {
      return {
        instantStopFadeSec: 0.014,
        instantStopFinalizeDelayMs: 18,
        defaultFadeOutMs: 900,
        brakeDurationSec: 1.35,
        brakeMinRate: 0.08,
        brakeWebDurationMs: 1350,
        backspinIOSPitchStart: 1.7,
        backspinIOSPitchEnd: 2.8,
        backspinIOSPitchRampSec: 0.22,
        backspinIOSDurationSec: 0.56,
        backspinWebSpeedUpMs: 420,
        backspinWebTotalMs: 900,
        backspinWebMaxRate: 2.8,
        backspinWebMinRate: 0.24,
        filterDurationSec: 1.2,
        filterEndHz: 120,
        volumeSmoothingSec: 0.016,
        softMuteSmoothingSec: 0.014,
        masterSmoothingSec: 0.012
      };
    }

    if (this.isAndroid) {
      return {
        instantStopFadeSec: 0.02,
        instantStopFinalizeDelayMs: 24,
        defaultFadeOutMs: 800,
        brakeDurationSec: 1.2,
        brakeMinRate: 0.1,
        brakeWebDurationMs: 1200,
        backspinIOSPitchStart: 1.8,
        backspinIOSPitchEnd: 3,
        backspinIOSPitchRampSec: 0.24,
        backspinIOSDurationSec: 0.58,
        backspinWebSpeedUpMs: 380,
        backspinWebTotalMs: 780,
        backspinWebMaxRate: 2.7,
        backspinWebMinRate: 0.28,
        filterDurationSec: 1.1,
        filterEndHz: 160,
        volumeSmoothingSec: 0.02,
        softMuteSmoothingSec: 0.018,
        masterSmoothingSec: 0.015
      };
    }

    return {
      instantStopFadeSec: 0.012,
      instantStopFinalizeDelayMs: 14,
      defaultFadeOutMs: 900,
      brakeDurationSec: 1.4,
      brakeMinRate: 0.08,
      brakeWebDurationMs: 1400,
      backspinIOSPitchStart: 1.8,
      backspinIOSPitchEnd: 3.1,
      backspinIOSPitchRampSec: 0.28,
      backspinIOSDurationSec: 0.62,
      backspinWebSpeedUpMs: 500,
      backspinWebTotalMs: 950,
      backspinWebMaxRate: 3,
      backspinWebMinRate: 0.2,
      filterDurationSec: 1.35,
      filterEndHz: 100,
      volumeSmoothingSec: 0.012,
      softMuteSmoothingSec: 0.01,
      masterSmoothingSec: 0.01
    };
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
    if (instance.stopEffectTimeoutId) {
      clearTimeout(instance.stopEffectTimeoutId);
      instance.stopEffectTimeoutId = null;
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
        instance.eqNodes.high.type = 'peaking';
        instance.eqNodes.high.frequency.setValueAtTime(10000, this.audioContext.currentTime);
      }

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
        // Connect: EQ -> filter -> gain -> shared gain
        instance.eqNodes.low!.connect(instance.eqNodes.mid!);
        instance.eqNodes.mid!.connect(instance.eqNodes.high!);
        instance.eqNodes.high!.connect(instance.filterNode!);
        instance.filterNode.connect(instance.gainNode);
        instance.gainNode.connect(this.sharedIOSGainNode);
      }

      // iOS fallback path: ensure media element is routed through WebAudio graph.
      if (instance.audioElement && !instance.sourceNode) {
        instance.sourceNode = this.audioContext.createMediaElementSource(instance.audioElement);
      }
      if (instance.sourceNode && !instance.sourceConnected) {
        instance.sourceNode.connect(instance.eqNodes.low || instance.filterNode || instance.gainNode!);
        instance.sourceConnected = true;
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
        instance.eqNodes.high.type = 'peaking';
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

      if (instance.sourceNode) {
        try {
          instance.sourceNode.disconnect();
        } catch (e) { }
        instance.sourceConnected = false;
      }
      
      instance.gainNode?.disconnect();
      instance.filterNode?.disconnect();
      instance.eqNodes.high?.disconnect();
      instance.eqNodes.mid?.disconnect();
      instance.eqNodes.low?.disconnect();
      instance.isConnected = false;
    } catch (error) {
      console.warn('Error disconnecting audio nodes:', error);
    }
  }

  playPad(padId: string): void {
    const instance = this.audioInstances.get(padId);
    if (!instance) return;

    instance.lastUsedTime = Date.now();
    const playToken = (instance.playToken || 0) + 1;
    instance.playToken = playToken;
    instance.pendingDecodePlayToken = null;

    // iOS: Use buffer-based playback for instant response
    if (this.isIOS) {
      this.playPadIOS(instance, playToken);
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
        if (instance.playToken !== playToken) return;
        this.proceedWithPlay(instance, playToken);
      });
      return; 
    }

    this.proceedWithPlay(instance, playToken);
  }

  // iOS optimized playback using AudioBufferSourceNode
  private playPadIOS(instance: AudioInstance, playToken: number): void {
    if (!this.audioContext) {
      console.error('No AudioContext for iOS playback');
      return;
    }

    // Ensure context is unlocked
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume().then(() => {
        if (instance.playToken !== playToken) return;
        this.playPadIOSInternal(instance, playToken);
      });
      return;
    }

    this.playPadIOSInternal(instance, playToken);
  }

  private playPadIOSInternal(instance: AudioInstance, playToken: number): void {
    if (!this.audioContext || !this.sharedIOSGainNode) return;
    if (instance.playToken !== playToken) return;

    // If no buffer, decode then auto-play when ready.
    if (!instance.audioBuffer) {
      instance.pendingDecodePlayToken = playToken;
      if (instance.lastAudioUrl && !instance.isBufferDecoding) {
        this.startBufferDecode(instance).finally(() => {
          if (instance.pendingDecodePlayToken !== playToken) return;
          if (instance.playToken !== playToken) return;
          this.playPadIOSInternal(instance, playToken);
        });
      }
      return;
    }
    instance.pendingDecodePlayToken = null;

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
    source.connect(instance.eqNodes.low || instance.filterNode || instance.gainNode!);
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
      if (instance.playToken !== playToken) return;
      if (instance.playbackMode === 'once' || instance.playbackMode === 'stopper') {
        instance.isPlaying = false;
        instance.progress = 0;
        instance.isFading = false;
        instance.pendingDecodePlayToken = null;
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

      if (instance.playToken !== playToken) {
        try {
          source.stop();
          source.disconnect();
        } catch (e) { }
        return;
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

  private proceedWithPlay(instance: AudioInstance, playToken: number): void {
    if (!instance.audioElement) return;
    if (instance.playToken !== playToken) return;

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
          if (instance.playToken !== playToken || !instance.audioElement) {
            if (instance.audioElement) {
              instance.audioElement.pause();
              instance.audioElement.muted = true;
            }
            return;
          }
          instance.isPlaying = true;
          instance.playStartTime = Date.now();
          instance.audioElement.muted = false;
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

  private getOrCreateReversedBackspinBuffer(instance: AudioInstance): AudioBuffer | null {
    if (!this.audioContext || !instance.audioBuffer) return null;
    if (instance.reversedBackspinBuffer) return instance.reversedBackspinBuffer;

    try {
      const source = instance.audioBuffer;
      const reversed = this.audioContext.createBuffer(
        source.numberOfChannels,
        source.length,
        source.sampleRate
      );
      for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
        const srcData = source.getChannelData(channel);
        const dstData = reversed.getChannelData(channel);
        for (let i = 0; i < srcData.length; i += 1) {
          dstData[i] = srcData[srcData.length - 1 - i];
        }
      }
      instance.reversedBackspinBuffer = reversed;
      return reversed;
    } catch (error) {
      console.error('Failed to create reversed backspin buffer:', error);
      return null;
    }
  }

  private getBufferPlaybackPositionMs(instance: AudioInstance): number {
    const regionStart = instance.startTimeMs || 0;
    const regionEnd = instance.endTimeMs > 0 ? instance.endTimeMs : instance.bufferDuration;
    const regionDuration = Math.max(0, regionEnd - regionStart);
    if (!instance.playStartTime || regionDuration <= 0) return regionStart;

    const elapsed = (Date.now() - instance.playStartTime) * Math.pow(2, (instance.pitch || 0) / 12);
    if (instance.playbackMode === 'loop' && regionDuration > 0) {
      const wrapped = elapsed % regionDuration;
      return regionStart + wrapped;
    }
    return Math.min(regionEnd, regionStart + elapsed);
  }

  private stopPadInstant(instance: AudioInstance, keepChannel?: boolean): void {
    instance.playToken += 1;
    instance.pendingDecodePlayToken = null;
    const timing = this.getStopTimingProfile();

    const finalizeStop = () => {
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
        instance.audioElement.muted = true;
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
    };

    this.stopFadeAutomation(instance);

    // Short safety fade prevents click/static on hard stop.
    if (instance.isPlaying && instance.gainNode && this.audioContext) {
      const now = this.audioContext.currentTime;
      const current = Math.max(0, instance.gainNode.gain.value);
      instance.gainNode.gain.cancelScheduledValues(now);
      instance.gainNode.gain.setValueAtTime(current, now);
      instance.gainNode.gain.linearRampToValueAtTime(0.0001, now + timing.instantStopFadeSec);
      instance.stopEffectTimeoutId = setTimeout(() => {
        instance.stopEffectTimeoutId = null;
        finalizeStop();
      }, timing.instantStopFinalizeDelayMs);
      return;
    }

    finalizeStop();
  }

  private stopPadFadeout(instance: AudioInstance): void {
    if (!instance.audioElement && !instance.bufferSourceNode) { this.stopPadInstant(instance); return; }
    this.stopFadeAutomation(instance);
    instance.isFading = true;
    const timing = this.getStopTimingProfile();
    const durationMs = instance.fadeOutMs > 0 ? instance.fadeOutMs : timing.defaultFadeOutMs;
    this.applyManualFadeOut(instance, () => this.stopPadInstant(instance), durationMs);
  }

  private stopPadBrake(instance: AudioInstance): void {
    const timing = this.getStopTimingProfile();
    // iOS buffer playback: Use AudioParam automation for brake effect
    if (this.isIOS && instance.bufferSourceNode && this.audioContext) {
      this.stopFadeAutomation(instance);
      instance.isFading = true;
      const currentRate = instance.bufferSourceNode.playbackRate.value;
      const duration = timing.brakeDurationSec;
      
      // Gradually slow down to near-stop
      instance.bufferSourceNode.playbackRate.cancelScheduledValues(this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.setValueAtTime(currentRate, this.audioContext.currentTime);
      instance.bufferSourceNode.playbackRate.linearRampToValueAtTime(timing.brakeMinRate, this.audioContext.currentTime + duration);
      
      // Also fade out the volume
      if (instance.gainNode) {
        const currentGain = Math.max(0.0001, instance.gainNode.gain.value);
        instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        instance.gainNode.gain.setValueAtTime(currentGain, this.audioContext.currentTime);
        instance.gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + duration);
      }
      
      // Stop after brake completes
      instance.stopEffectTimeoutId = setTimeout(() => {
        instance.stopEffectTimeoutId = null;
        this.stopPadInstant(instance);
      }, duration * 1000);
      return;
    }
    
    if (!instance.audioElement) { this.stopPadInstant(instance); return; }
    this.stopFadeAutomation(instance);
    const originalRate = instance.audioElement.playbackRate;
    const durationMs = timing.brakeWebDurationMs;
    const startTime = performance.now();
    const initialGain = instance.gainNode ? instance.gainNode.gain.value : this.getBaseGain(instance);
    instance.isFading = true;
    if (instance.fadeAnimationFrameId !== null) {
      cancelAnimationFrame(instance.fadeAnimationFrameId);
    }

    const animateBrake = () => {
      if (!instance.audioElement || !instance.isPlaying) {
        instance.fadeAnimationFrameId = null;
        return;
      }

      const progress = Math.min(1, (performance.now() - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 2);
      const newRate = originalRate * (1 - (eased * 0.95));
      instance.audioElement.playbackRate = Math.max(timing.brakeMinRate, newRate);

      if (instance.gainNode && this.audioContext) {
        const target = Math.max(0, initialGain * (1 - eased));
        instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        instance.gainNode.gain.setValueAtTime(target, this.audioContext.currentTime);
      }

      if (progress >= 1) {
        if (instance.audioElement) {
          instance.audioElement.playbackRate = originalRate;
        }
        instance.fadeAnimationFrameId = null;
        this.stopPadInstant(instance);
        return;
      }

      instance.fadeAnimationFrameId = requestAnimationFrame(animateBrake);
    };

    instance.fadeAnimationFrameId = requestAnimationFrame(animateBrake);
  }

  private stopPadBackspin(instance: AudioInstance): void {
    const timing = this.getStopTimingProfile();
    // iOS buffer playback: reverse + high-pitch burst for realistic backspin.
    if (this.isIOS && instance.bufferSourceNode && this.audioContext) {
      this.stopFadeAutomation(instance);
      instance.isFading = true;

      const reverseBuffer = this.getOrCreateReversedBackspinBuffer(instance);
      const now = this.audioContext.currentTime;

      // Stop the forward source first.
      try {
        instance.bufferSourceNode.stop();
        instance.bufferSourceNode.disconnect();
      } catch (e) { }

      if (!reverseBuffer || !instance.gainNode) {
        this.stopPadInstant(instance);
        return;
      }

      const currentPosMs = this.getBufferPlaybackPositionMs(instance);
      const currentPosSec = Math.max(0, Math.min(reverseBuffer.duration, currentPosMs / 1000));
      const reverseOffset = Math.max(0, Math.min(reverseBuffer.duration - 0.02, reverseBuffer.duration - currentPosSec));

      const reverseSource = this.audioContext.createBufferSource();
      reverseSource.buffer = reverseBuffer;
      reverseSource.playbackRate.setValueAtTime(timing.backspinIOSPitchStart, now);
      reverseSource.playbackRate.linearRampToValueAtTime(
        timing.backspinIOSPitchEnd,
        now + timing.backspinIOSPitchRampSec
      );
      reverseSource.connect(instance.eqNodes.low || instance.filterNode || instance.gainNode);
      instance.bufferSourceNode = reverseSource;
      instance.playStartTime = Date.now();

      const currentGain = Math.max(0.0001, instance.gainNode.gain.value || this.getBaseGain(instance));
      instance.gainNode.gain.cancelScheduledValues(now);
      instance.gainNode.gain.setValueAtTime(currentGain, now);
      instance.gainNode.gain.exponentialRampToValueAtTime(0.0001, now + timing.backspinIOSDurationSec);

      try {
        reverseSource.start(0, reverseOffset, timing.backspinIOSDurationSec);
      } catch (error) {
        console.error('Backspin reverse start failed:', error);
        this.stopPadInstant(instance);
        return;
      }

      instance.stopEffectTimeoutId = setTimeout(() => {
        instance.stopEffectTimeoutId = null;
        this.stopPadInstant(instance);
      }, Math.ceil((timing.backspinIOSDurationSec * 1000) + 24));
      return;
    }
    
    if (!instance.audioElement) { this.stopPadInstant(instance); return; }
    this.stopFadeAutomation(instance);
    const originalRate = instance.audioElement.playbackRate;
    const speedUpMs = timing.backspinWebSpeedUpMs;
    const totalMs = timing.backspinWebTotalMs;
    const startTime = performance.now();
    const initialGain = instance.gainNode ? instance.gainNode.gain.value : this.getBaseGain(instance);
    instance.isFading = true;
    if (instance.fadeAnimationFrameId !== null) {
      cancelAnimationFrame(instance.fadeAnimationFrameId);
    }

    const animateBackspin = () => {
      if (!instance.audioElement || !instance.isPlaying) {
        instance.fadeAnimationFrameId = null;
        return;
      }

      const elapsed = performance.now() - startTime;
      const totalProgress = Math.min(1, elapsed / totalMs);

      if (elapsed <= speedUpMs) {
        const speedProgress = elapsed / speedUpMs;
        instance.audioElement.playbackRate = Math.min(
          timing.backspinWebMaxRate,
          originalRate + ((timing.backspinWebMaxRate - originalRate) * speedProgress)
        );
      } else {
        const fadeProgress = Math.min(1, (elapsed - speedUpMs) / (totalMs - speedUpMs));
        instance.audioElement.playbackRate = Math.max(
          timing.backspinWebMinRate,
          timing.backspinWebMaxRate - ((timing.backspinWebMaxRate - timing.backspinWebMinRate) * fadeProgress)
        );
        if (instance.gainNode && this.audioContext) {
          const target = Math.max(0, initialGain * (1 - fadeProgress));
          instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
          instance.gainNode.gain.setValueAtTime(target, this.audioContext.currentTime);
        }
      }

      if (totalProgress >= 1) {
        if (instance.audioElement) {
          instance.audioElement.playbackRate = originalRate;
        }
        instance.fadeAnimationFrameId = null;
        this.stopPadInstant(instance);
        return;
      }

      instance.fadeAnimationFrameId = requestAnimationFrame(animateBackspin);
    };

    instance.fadeAnimationFrameId = requestAnimationFrame(animateBackspin);
  }

  private stopPadFilter(instance: AudioInstance): void {
    if (!instance.filterNode || !this.audioContext) {
      this.stopPadInstant(instance);
      return;
    }
    
    const timing = this.getStopTimingProfile();
    const duration = timing.filterDurationSec;
    this.stopFadeAutomation(instance);
    instance.isFading = true;
    
    // Apply filter sweep: 20kHz → 100Hz
    instance.filterNode.frequency.cancelScheduledValues(this.audioContext.currentTime);
    instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
    instance.filterNode.frequency.exponentialRampToValueAtTime(timing.filterEndHz, this.audioContext.currentTime + duration);

    if (instance.gainNode) {
      const currentGain = Math.max(0.0001, instance.gainNode.gain.value);
      instance.gainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
      instance.gainNode.gain.setValueAtTime(currentGain, this.audioContext.currentTime);
      instance.gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + duration);
    }

    instance.stopEffectTimeoutId = setTimeout(() => {
      instance.stopEffectTimeoutId = null;
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
    if (instance.isPlaying && !(instance.fadeInMs > 0 && instance.fadeInStartTime === null)) {
      this.updateInstanceVolume(instance);
    }
    instance.audioElement.playbackRate = Math.pow(2, instance.pitch / 12);
    if (instance.filterNode && this.audioContext) instance.filterNode.frequency.setValueAtTime(20000, this.audioContext.currentTime);
  }

  private updateInstanceVolume(instance: AudioInstance): void {
    if (!instance.isConnected || !instance.gainNode || !this.audioContext) return;
    if (instance.isFading || instance.fadeInStartTime || instance.fadeOutStartTime) return;
    const targetVolume = this.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
    const now = this.audioContext.currentTime;
    const timing = this.getStopTimingProfile();
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setTargetAtTime(Math.max(0, targetVolume), now, timing.volumeSmoothingSec);
  }

  private applySoftMute(instance: AudioInstance): void {
    if (!instance.gainNode || !this.audioContext) return;
    // Cancel fades so soft-mute takes immediate effect
    this.stopFadeAutomation(instance);
    const targetVolume = this.getBaseGain(instance);
    if (instance.audioElement) instance.audioElement.volume = 1.0;
    const now = this.audioContext.currentTime;
    const timing = this.getStopTimingProfile();
    instance.gainNode.gain.cancelScheduledValues(now);
    instance.gainNode.gain.setTargetAtTime(Math.max(0, targetVolume), now, timing.softMuteSmoothingSec);
  }

  private updateInstanceEQ(instance: AudioInstance): void {
    if (!instance.isConnected || !this.audioContext) return;
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
    // Coalesce high-frequency updates without starving renders.
    if (this.notificationTimeout) return;
    this.notificationTimeout = setTimeout(() => {
      this.notificationTimeout = null;
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
    this.deckChannels.forEach((channel) => {
      if (channel.loadedPadRef?.padId === padId) {
        this.unloadChannel(channel.channelId);
      }
    });
    this.releaseChannel(instance);
    this.cleanupInstance(instance);
    this.audioInstances.delete(padId);
    this.registeredPads.delete(padId);
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
    const registered = this.registeredPads.get(padId);
    
    const fadeSettingsChanged = 
      settings.fadeInMs !== undefined || 
      settings.fadeOutMs !== undefined || 
      settings.startTimeMs !== undefined || 
      settings.endTimeMs !== undefined;
    
    if (settings.triggerMode !== undefined) instance.triggerMode = settings.triggerMode;
    if (settings.playbackMode !== undefined) {
      instance.playbackMode = settings.playbackMode;
      if (instance.audioElement) instance.audioElement.loop = settings.playbackMode === 'loop';
      if (registered) {
        registered.playbackMode = settings.playbackMode === 'loop'
          ? 'loop'
          : settings.playbackMode === 'stopper'
            ? 'stopper'
            : 'once';
      }
    }
    if (settings.startTimeMs !== undefined) {
      instance.startTimeMs = settings.startTimeMs;
      if (registered) registered.startTimeMs = settings.startTimeMs;
    }
    if (settings.endTimeMs !== undefined) {
      instance.endTimeMs = settings.endTimeMs;
      if (registered) registered.endTimeMs = settings.endTimeMs;
    }
    if (settings.fadeInMs !== undefined) {
      instance.fadeInMs = settings.fadeInMs;
      if (registered) registered.fadeInMs = settings.fadeInMs;
    }
    if (settings.fadeOutMs !== undefined) {
      instance.fadeOutMs = settings.fadeOutMs;
      if (registered) registered.fadeOutMs = settings.fadeOutMs;
    }
    if (settings.pitch !== undefined) {
      instance.pitch = settings.pitch;
      if (registered) registered.pitch = settings.pitch;
      if (instance.audioElement) instance.audioElement.playbackRate = Math.pow(2, settings.pitch / 12);
      if (instance.bufferSourceNode && this.audioContext) {
        instance.bufferSourceNode.playbackRate.setValueAtTime(Math.pow(2, settings.pitch / 12), this.audioContext.currentTime);
      }
    }
    if (settings.volume !== undefined) {
      instance.volume = settings.volume;
      if (registered) registered.volume = settings.volume;
      this.updateInstanceVolume(instance);
    }
    if (settings.savedHotcuesMs !== undefined && registered) {
      registered.savedHotcuesMs = Array.isArray(settings.savedHotcuesMs)
        ? (settings.savedHotcuesMs.slice(0, 4) as HotcueTuple)
        : [null, null, null, null];
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
    const registered = this.registeredPads.get(padId);
    if (metadata.name !== undefined) instance.padName = metadata.name;
    if (metadata.color !== undefined) instance.color = metadata.color;
    if (metadata.bankId !== undefined) instance.bankId = metadata.bankId;
    if (metadata.bankName !== undefined) instance.bankName = metadata.bankName;
    if (registered) {
      if (metadata.name !== undefined) registered.padName = metadata.name;
      if (metadata.color !== undefined) registered.color = metadata.color;
      if (metadata.bankId !== undefined) registered.bankId = metadata.bankId;
      if (metadata.bankName !== undefined) registered.bankName = metadata.bankName;
    }
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

  private cloneHotcues(value?: unknown): HotcueTuple {
    if (!Array.isArray(value)) return [null, null, null, null];
    const next: HotcueTuple = [null, null, null, null];
    for (let i = 0; i < 4; i += 1) {
      const cue = value[i];
      next[i] = typeof cue === 'number' && Number.isFinite(cue) && cue >= 0 ? cue : null;
    }
    return next;
  }

  private ensureDeckChannelRuntime(channelId: number): DeckChannelRuntime | null {
    if (!Number.isFinite(channelId)) return null;
    if (channelId < 1 || channelId > MAX_PLAYBACK_CHANNELS) return null;
    const existing = this.deckChannels.get(channelId);
    if (existing) {
      if (!this.channelVolumes.has(channelId)) {
        this.channelVolumes.set(channelId, existing.channelVolume);
      }
      return existing;
    }

    const runtime: DeckChannelRuntime = {
      channelId,
      channelVolume: this.channelVolumes.get(channelId) ?? 1,
      loadedPadRef: null,
      pad: null,
      audioElement: null,
      sourceNode: null,
      sourceConnected: false,
      gainNode: null,
      eqNodes: { low: null, mid: null, high: null },
      graphConnected: false,
      pendingInitialSeekSec: null,
      isPlaying: false,
      isPaused: false,
      playheadMs: 0,
      durationMs: 0,
      hotcuesMs: [null, null, null, null],
      hasLocalHotcueOverride: false,
      collapsed: false,
      waveformKey: null
    };
    this.channelVolumes.set(channelId, runtime.channelVolume);
    this.deckChannels.set(channelId, runtime);
    return runtime;
  }

  private getDeckChannel(channelId: number): DeckChannelRuntime | null {
    if (!Number.isFinite(channelId)) return null;
    if (channelId < 1 || channelId > MAX_PLAYBACK_CHANNELS) return null;
    return this.deckChannels.get(channelId) || null;
  }

  private getDeckStartMs(channel: DeckChannelRuntime): number {
    return channel.pad?.startTimeMs || 0;
  }

  private getDeckEndMs(channel: DeckChannelRuntime): number {
    if (!channel.pad) return 0;
    if (channel.pad.endTimeMs > channel.pad.startTimeMs) return channel.pad.endTimeMs;
    return channel.durationMs > channel.pad.startTimeMs ? channel.durationMs : channel.pad.startTimeMs;
  }

  private startDeckPlaybackLoop(): void {
    if (this.deckPlaybackRafId !== null) return;

    const tick = () => {
      this.deckPlaybackRafId = null;
      let hasPlayingChannel = false;

      for (let i = 1; i <= this.deckChannelCount; i += 1) {
        const channel = this.getDeckChannel(i);
        if (!channel?.audioElement || !channel.pad || !channel.isPlaying) continue;

        hasPlayingChannel = true;
        const nowAbsMs = channel.audioElement.currentTime * 1000;
        const start = this.getDeckStartMs(channel);
        const end = this.getDeckEndMs(channel);
        channel.playheadMs = Math.max(0, Math.min(Math.max(0, end - start), nowAbsMs - start));

        if (end > start && nowAbsMs >= end) {
          this.stopChannel(channel.channelId, 'instant');
          continue;
        }
      }

      if (hasPlayingChannel) {
        this.notifyStateChange();
        this.deckPlaybackRafId = requestAnimationFrame(tick);
      }
    };

    this.deckPlaybackRafId = requestAnimationFrame(tick);
  }

  private stopDeckPlaybackLoopIfIdle(): void {
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (channel?.isPlaying) return;
    }
    if (this.deckPlaybackRafId !== null) {
      cancelAnimationFrame(this.deckPlaybackRafId);
      this.deckPlaybackRafId = null;
    }
  }

  private setDeckChannelCurrentTimeSafe(channel: DeckChannelRuntime, nextSec: number): void {
    const audio = channel.audioElement;
    if (!audio) return;
    const safeSec = Math.max(0, nextSec);
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      try {
        audio.currentTime = safeSec;
        channel.pendingInitialSeekSec = null;
        return;
      } catch {}
    }
    channel.pendingInitialSeekSec = safeSec;
  }

  private ensureDeckChannelAudioGraph(channel: DeckChannelRuntime): void {
    if (!channel.audioElement) return;
    if (!this.audioContext) this.initializeAudioContext();
    if (!this.audioContext) return;

    // iOS deck channels route through WebAudio to make EQ and channel volume reliable.
    if (this.isIOS && !this.sharedIOSGainNode) {
      this.setupSharedIOSNodes();
      if (!this.sharedIOSGainNode) return;
    }

    try {
      if (!channel.eqNodes.low) {
        channel.eqNodes.low = this.audioContext.createBiquadFilter();
        channel.eqNodes.low.type = 'peaking';
        channel.eqNodes.low.frequency.setValueAtTime(100, this.audioContext.currentTime);
      }
      if (!channel.eqNodes.mid) {
        channel.eqNodes.mid = this.audioContext.createBiquadFilter();
        channel.eqNodes.mid.type = 'peaking';
        channel.eqNodes.mid.frequency.setValueAtTime(1000, this.audioContext.currentTime);
      }
      if (!channel.eqNodes.high) {
        channel.eqNodes.high = this.audioContext.createBiquadFilter();
        channel.eqNodes.high.type = 'peaking';
        channel.eqNodes.high.frequency.setValueAtTime(10000, this.audioContext.currentTime);
      }
      if (!channel.gainNode) {
        channel.gainNode = this.audioContext.createGain();
      }

      if (!channel.sourceNode) {
        channel.sourceNode = this.audioContext.createMediaElementSource(channel.audioElement);
      }

      if (!channel.sourceConnected && channel.sourceNode) {
        channel.sourceNode.connect(channel.eqNodes.low!);
        channel.eqNodes.low!.connect(channel.eqNodes.mid!);
        channel.eqNodes.mid!.connect(channel.eqNodes.high!);
        channel.eqNodes.high!.connect(channel.gainNode!);
        if (this.isIOS && this.sharedIOSGainNode) {
          channel.gainNode!.connect(this.sharedIOSGainNode);
        } else {
          channel.gainNode!.connect(this.audioContext.destination);
        }
        channel.sourceConnected = true;
      }

      channel.graphConnected = true;
      channel.audioElement.muted = false;
      channel.audioElement.volume = 1.0;
      this.updateDeckChannelEQ(channel);
      this.syncDeckChannelVolume(channel);
    } catch (error) {
      console.warn(`Failed to connect deck channel ${channel.channelId} WebAudio graph:`, error);
      channel.graphConnected = false;
    }
  }

  private disconnectDeckChannelAudioGraph(channel: DeckChannelRuntime): void {
    try {
      channel.sourceNode?.disconnect();
    } catch {}
    try {
      channel.eqNodes.low?.disconnect();
    } catch {}
    try {
      channel.eqNodes.mid?.disconnect();
    } catch {}
    try {
      channel.eqNodes.high?.disconnect();
    } catch {}
    try {
      channel.gainNode?.disconnect();
    } catch {}

    channel.sourceNode = null;
    channel.sourceConnected = false;
    channel.eqNodes = { low: null, mid: null, high: null };
    channel.gainNode = null;
    channel.graphConnected = false;
    channel.pendingInitialSeekSec = null;
  }

  private getDeckChannelTargetGain(channel: DeckChannelRuntime): number {
    if (!channel.pad) return 0;
    const padVolume = Math.max(0, Math.min(1, channel.pad.volume || 1));
    const channelVolume = Math.max(0, Math.min(1, channel.channelVolume || 1));
    if (this.globalMuted) return 0;

    // On iOS graph path, master is controlled by sharedIOSGainNode.
    if (this.isIOS && channel.graphConnected && this.sharedIOSGainNode) {
      return Math.max(0, Math.min(1, padVolume * channelVolume));
    }
    return Math.max(0, Math.min(1, padVolume * channelVolume * this.masterVolume));
  }

  private setDeckChannelGain(channel: DeckChannelRuntime, next: number, immediate: boolean = false): void {
    const target = Math.max(0, Math.min(1, next));
    if (channel.gainNode && channel.graphConnected && this.audioContext) {
      const now = this.audioContext.currentTime;
      channel.gainNode.gain.cancelScheduledValues(now);
      if (immediate) {
        channel.gainNode.gain.setValueAtTime(target, now);
      } else {
        const timing = this.getStopTimingProfile();
        channel.gainNode.gain.setTargetAtTime(target, now, timing.volumeSmoothingSec);
      }
      if (channel.audioElement) channel.audioElement.volume = 1.0;
      return;
    }
    if (channel.audioElement) {
      channel.audioElement.volume = target;
    }
  }

  private getDeckChannelCurrentGain(channel: DeckChannelRuntime): number {
    if (channel.gainNode && channel.graphConnected) {
      return Math.max(0, channel.gainNode.gain.value || 0);
    }
    return Math.max(0, channel.audioElement?.volume || 0);
  }

  private updateDeckChannelEQ(channel: DeckChannelRuntime): void {
    if (!this.audioContext || !channel.graphConnected) return;
    const now = this.audioContext.currentTime;
    if (channel.eqNodes.low) channel.eqNodes.low.gain.setValueAtTime(this.globalEQ.low, now);
    if (channel.eqNodes.mid) channel.eqNodes.mid.gain.setValueAtTime(this.globalEQ.mid, now);
    if (channel.eqNodes.high) channel.eqNodes.high.gain.setValueAtTime(this.globalEQ.high, now);
  }

  private syncDeckChannelVolume(channel: DeckChannelRuntime): void {
    if (!channel.audioElement || !channel.pad) return;
    const next = this.getDeckChannelTargetGain(channel);
    this.setDeckChannelGain(channel, next);
  }

  private releaseWaveformRef(channel: DeckChannelRuntime): void {
    if (!channel.waveformKey) return;
    const key = channel.waveformKey;
    const count = this.waveformCacheRefs.get(key) || 0;
    if (count <= 1) this.waveformCacheRefs.delete(key);
    else this.waveformCacheRefs.set(key, count - 1);
    channel.waveformKey = null;
  }

  private retainWaveformRef(channel: DeckChannelRuntime, key: string): void {
    this.releaseWaveformRef(channel);
    channel.waveformKey = key;
    this.waveformCacheRefs.set(key, (this.waveformCacheRefs.get(key) || 0) + 1);
  }

  private createDeckAudioElement(channel: DeckChannelRuntime): void {
    if (!channel.pad) return;
    const audio = new Audio(channel.pad.audioUrl);
    audio.preload = 'auto';
    audio.loop = channel.pad.playbackMode === 'loop';
    audio.playbackRate = Math.pow(2, (channel.pad.pitch || 0) / 12);
    channel.pendingInitialSeekSec = (channel.pad.startTimeMs || 0) / 1000;
    this.disconnectDeckChannelAudioGraph(channel);

    audio.addEventListener('loadedmetadata', () => {
      if (!channel.pad) return;
      if (channel.pendingInitialSeekSec !== null) {
        this.setDeckChannelCurrentTimeSafe(channel, channel.pendingInitialSeekSec);
      }
      const fullMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
      const regionEnd = channel.pad.endTimeMs > channel.pad.startTimeMs
        ? channel.pad.endTimeMs
        : fullMs;
      channel.durationMs = Math.max(channel.pad.startTimeMs, regionEnd);
      this.notifyStateChange();
    });

    audio.addEventListener('timeupdate', () => {
      if (!channel.pad) return;
      const nowAbsMs = audio.currentTime * 1000;
      const start = this.getDeckStartMs(channel);
      const end = this.getDeckEndMs(channel);
      channel.playheadMs = Math.max(0, Math.min(Math.max(0, end - start), nowAbsMs - start));
      if (end > start && nowAbsMs >= end) {
        this.stopChannel(channel.channelId, 'instant');
        return;
      }
    });

    audio.addEventListener('ended', () => {
      channel.isPlaying = false;
      channel.isPaused = false;
      channel.playheadMs = 0;
      if (channel.pad && channel.audioElement) {
        this.setDeckChannelCurrentTimeSafe(channel, (channel.pad.startTimeMs || 0) / 1000);
      }
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();
    });

    channel.audioElement = audio;
    this.ensureDeckChannelAudioGraph(channel);
    this.syncDeckChannelVolume(channel);
  }

  private stopDeckChannelInternal(channel: DeckChannelRuntime, mode: StopMode = 'instant'): void {
    const audio = channel.audioElement;
    const pad = channel.pad;
    if (!audio || !pad) {
      channel.isPlaying = false;
      channel.isPaused = false;
      channel.playheadMs = 0;
      this.stopDeckPlaybackLoopIfIdle();
      return;
    }

    const startAtSec = (pad.startTimeMs || 0) / 1000;
    const finalizeStop = () => {
      try {
        audio.pause();
        this.setDeckChannelCurrentTimeSafe(channel, startAtSec);
        audio.playbackRate = Math.pow(2, (pad.pitch || 0) / 12);
      } catch {}
      channel.isPlaying = false;
      channel.isPaused = false;
      channel.playheadMs = 0;
      this.syncDeckChannelVolume(channel);
      this.stopDeckPlaybackLoopIfIdle();
      this.notifyStateChange();
    };

    if (!channel.isPlaying && mode !== 'instant') {
      finalizeStop();
      return;
    }

    if (mode === 'instant') {
      const startVolume = this.getDeckChannelCurrentGain(channel);
      const fadeMs = Math.max(10, this.getStopTimingProfile().instantStopFinalizeDelayMs);
      const startedAt = performance.now();
      const fadeTick = () => {
        const progress = Math.min(1, (performance.now() - startedAt) / fadeMs);
        this.setDeckChannelGain(channel, Math.max(0, startVolume * (1 - progress)), true);
        if (progress >= 1 || !channel.isPlaying) {
          finalizeStop();
          return;
        }
        requestAnimationFrame(fadeTick);
      };
      requestAnimationFrame(fadeTick);
      return;
    }

    const runAnimatedStop = (durationMs: number, onFrame: (progress: number, startVolume: number, originalRate: number) => void, onEnd?: () => void) => {
      const startVolume = this.getDeckChannelCurrentGain(channel);
      const originalRate = audio.playbackRate;
      const startedAt = performance.now();
      const tick = () => {
        const progress = Math.min(1, (performance.now() - startedAt) / durationMs);
        onFrame(progress, startVolume, originalRate);
        if (progress >= 1 || !channel.isPlaying) {
          if (onEnd) onEnd();
          finalizeStop();
          return;
        }
        requestAnimationFrame(tick);
      };
      channel.isPlaying = true;
      channel.isPaused = false;
      requestAnimationFrame(tick);
    };

    if (mode === 'fadeout' || mode === 'filter') {
      const durationMs = mode === 'filter' ? 850 : 650;
      runAnimatedStop(durationMs, (progress, startVolume, originalRate) => {
        audio.playbackRate = Math.max(0.9, originalRate - (originalRate - 0.85) * progress);
        this.setDeckChannelGain(channel, Math.max(0, startVolume * (1 - progress)), true);
      });
      return;
    }

    if (mode === 'brake') {
      const durationMs = this.getStopTimingProfile().brakeWebDurationMs;
      runAnimatedStop(durationMs, (progress, startVolume, originalRate) => {
        const nextRate = Math.max(0.08, originalRate * (1 - progress * 0.94));
        audio.playbackRate = nextRate;
        this.setDeckChannelGain(channel, Math.max(0, startVolume * (1 - progress)), true);
      }, () => {
        audio.playbackRate = Math.max(0.08, audio.playbackRate);
      });
      return;
    }

    // backspin approximation for HTMLAudioElement path
    const backspinBaseRate = audio.playbackRate;
    runAnimatedStop(820, (progress, startVolume, originalRate) => {
      if (progress < 0.45) {
        const p = progress / 0.45;
        audio.playbackRate = originalRate + (2.8 - originalRate) * p;
      } else {
        const p = (progress - 0.45) / 0.55;
        audio.playbackRate = Math.max(0.2, 2.8 - (2.6 * p));
      }
      this.setDeckChannelGain(channel, Math.max(0, startVolume * (1 - progress)), true);
    }, () => {
      audio.playbackRate = backspinBaseRate;
    });
  }

  loadPadToChannel(channelId: number, padId: string): boolean {
    if (channelId < 1 || channelId > this.deckChannelCount) return false;
    const channel = this.getDeckChannel(channelId) || this.ensureDeckChannelRuntime(channelId);
    if (!channel) return false;
    const pad = this.registeredPads.get(padId);
    if (!pad || !pad.audioUrl) return false;

    if (channel.loadedPadRef?.padId === padId && channel.loadedPadRef?.bankId === pad.bankId) {
      return true;
    }

    this.stopDeckChannelInternal(channel, 'instant');
    if (channel.audioElement) {
      try {
        channel.audioElement.pause();
        channel.audioElement.src = '';
      } catch {}
    }
    this.disconnectDeckChannelAudioGraph(channel);
    this.releaseWaveformRef(channel);

    channel.loadedPadRef = { bankId: pad.bankId, padId: pad.padId };
    channel.pad = { ...pad, savedHotcuesMs: this.cloneHotcues(pad.savedHotcuesMs) };
    channel.isPlaying = false;
    channel.isPaused = false;
    channel.playheadMs = 0;
    channel.durationMs = Math.max(channel.pad.startTimeMs || 0, channel.pad.endTimeMs || 0);
    channel.hotcuesMs = this.cloneHotcues(channel.pad.savedHotcuesMs);
    channel.hasLocalHotcueOverride = false;
    this.retainWaveformRef(channel, `${pad.padId}:${pad.audioUrl}`);
    this.createDeckAudioElement(channel);
    this.notifyStateChange();
    return true;
  }

  unloadChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    this.stopDeckChannelInternal(channel, 'instant');
    if (channel.audioElement) {
      try {
        channel.audioElement.pause();
        channel.audioElement.src = '';
      } catch {}
    }
    this.disconnectDeckChannelAudioGraph(channel);
    channel.audioElement = null;
    channel.loadedPadRef = null;
    channel.pad = null;
    channel.isPlaying = false;
    channel.isPaused = false;
    channel.playheadMs = 0;
    channel.durationMs = 0;
    channel.hotcuesMs = [null, null, null, null];
    channel.hasLocalHotcueOverride = false;
    this.releaseWaveformRef(channel);
    this.notifyStateChange();
  }

  playChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement || !channel.pad) return;

    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume().catch((error) => {
        console.warn('Failed to resume AudioContext before channel playback:', error);
      });
    }

    this.ensureDeckChannelAudioGraph(channel);
    channel.audioElement.playbackRate = Math.pow(2, (channel.pad.pitch || 0) / 12);
    channel.audioElement.loop = channel.pad.playbackMode === 'loop';
    if (channel.pendingInitialSeekSec !== null) {
      this.setDeckChannelCurrentTimeSafe(channel, channel.pendingInitialSeekSec);
    }
    this.syncDeckChannelVolume(channel);
    channel.audioElement.play().then(() => {
      channel.isPlaying = true;
      channel.isPaused = false;
      this.startDeckPlaybackLoop();
      this.notifyStateChange();
    }).catch((error) => {
      console.warn(`Channel ${channelId} play() failed:`, error);
      this.notifyStateChange();
    });
  }

  pauseChannel(channelId: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement) return;
    try {
      channel.audioElement.pause();
    } catch {}
    channel.isPlaying = false;
    channel.isPaused = true;
    this.stopDeckPlaybackLoopIfIdle();
    this.notifyStateChange();
  }

  seekChannel(channelId: number, ms: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel || !channel.audioElement || !channel.pad) return;
    const start = this.getDeckStartMs(channel);
    const end = this.getDeckEndMs(channel);
    const clamped = Math.max(0, Math.min(end > start ? end - start : 0, ms));
    channel.playheadMs = clamped;
    this.setDeckChannelCurrentTimeSafe(channel, (start + clamped) / 1000);
    this.notifyStateChange();
  }

  setChannelHotcue(channelId: number, slotIndex: number, ms: number | null): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    if (slotIndex < 0 || slotIndex > 3) return;
    if (ms === null) {
      channel.hotcuesMs[slotIndex] = null;
    } else {
      const safe = Math.max(0, ms);
      channel.hotcuesMs[slotIndex] = safe;
    }
    channel.hasLocalHotcueOverride = true;
    this.notifyStateChange();
  }

  clearChannelHotcue(channelId: number, slotIndex: number): void {
    this.setChannelHotcue(channelId, slotIndex, null);
  }

  triggerChannelHotcue(channelId: number, slotIndex: number): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    if (slotIndex < 0 || slotIndex > 3) return;
    const cue = channel.hotcuesMs[slotIndex];
    if (cue === null || cue === undefined) return;
    this.seekChannel(channelId, cue);
    this.playChannel(channelId);
  }

  setChannelCollapsed(channelId: number, collapsed: boolean): void {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    channel.collapsed = collapsed;
    this.notifyStateChange();
  }

  private cleanupRemovedChannels(keepCount: number): void {
    for (let i = keepCount + 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      this.unloadChannel(i);
      this.deckChannels.delete(i);
      this.channelVolumes.delete(i);
    }
  }

  setChannelCount(count: number): void {
    const safe = Math.max(2, Math.min(MAX_PLAYBACK_CHANNELS, Math.floor(count)));
    if (safe === this.deckChannelCount) return;
    if (safe < this.deckChannelCount) {
      this.cleanupRemovedChannels(safe);
    }
    if (safe > this.deckChannelCount) {
      for (let i = 1; i <= safe; i += 1) {
        this.ensureDeckChannelRuntime(i);
      }
    }
    this.deckChannelCount = safe;
    this.notifyStateChange();
  }

  getChannelCount(): number {
    return this.deckChannelCount;
  }

  resetDeckPlaybackToStart(): void {
    for (let i = 1; i <= MAX_PLAYBACK_CHANNELS; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel || !channel.pad) continue;
      this.stopDeckChannelInternal(channel, 'instant');
      channel.isPaused = false;
      channel.playheadMs = 0;
      if (channel.audioElement) {
        this.setDeckChannelCurrentTimeSafe(channel, (channel.pad.startTimeMs || 0) / 1000);
      }
    }
    this.notifyStateChange();
  }

  hydrateDeckLayout(deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number }>): void {
    if (!Array.isArray(deckState)) return;
    deckState.forEach((entry) => {
      const channel = this.getDeckChannel(entry.channelId);
      if (!channel) return;
      if (typeof entry.channelVolume === 'number' && Number.isFinite(entry.channelVolume)) {
        this.setChannelVolume(entry.channelId, entry.channelVolume);
      }
      if (typeof entry.collapsed === 'boolean') {
        channel.collapsed = entry.collapsed;
      }
      if (!entry.loadedPadRef?.padId) {
        this.unloadChannel(entry.channelId);
        return;
      }
      const loaded = this.loadPadToChannel(entry.channelId, entry.loadedPadRef.padId);
      if (!loaded) return;
      if (Array.isArray(entry.hotcuesMs)) {
        channel.hotcuesMs = this.cloneHotcues(entry.hotcuesMs);
        channel.hasLocalHotcueOverride = true;
      }
      this.stopDeckChannelInternal(channel, 'instant');
      channel.isPaused = false;
      channel.playheadMs = 0;
    });
    this.notifyStateChange();
  }

  persistDeckLayoutSnapshot(): Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs: HotcueTuple; collapsed: boolean; channelVolume: number }> {
    const items: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs: HotcueTuple; collapsed: boolean; channelVolume: number }> = [];
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      items.push({
        channelId: i,
        loadedPadRef: channel.loadedPadRef ? { ...channel.loadedPadRef } : null,
        hotcuesMs: this.cloneHotcues(channel.hotcuesMs),
        collapsed: channel.collapsed,
        channelVolume: channel.channelVolume
      });
    }
    return items;
  }

  saveChannelHotcuesToPad(channelId: number): { ok: boolean; padId?: string } {
    const channel = this.getDeckChannel(channelId);
    if (!channel?.loadedPadRef?.padId) return { ok: false };
    const snapshot = this.registeredPads.get(channel.loadedPadRef.padId);
    if (!snapshot) return { ok: false };
    snapshot.savedHotcuesMs = this.cloneHotcues(channel.hotcuesMs);
    channel.hasLocalHotcueOverride = false;
    this.notifyStateChange();
    return { ok: true, padId: snapshot.padId };
  }

  getDeckChannelStates(): DeckChannelState[] {
    const result: DeckChannelState[] = [];
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (!channel) continue;
      const pad = channel.pad ? {
        padId: channel.pad.padId,
        padName: channel.pad.padName,
        bankId: channel.pad.bankId,
        bankName: channel.pad.bankName,
        audioUrl: channel.pad.audioUrl,
        color: channel.pad.color,
        volume: channel.pad.volume,
        effectiveVolume: Math.max(0, Math.min(1, channel.pad.volume * channel.channelVolume * this.masterVolume)),
        currentMs: channel.playheadMs,
        endMs: Math.max(0, this.getDeckEndMs(channel) - this.getDeckStartMs(channel)),
        playStartTime: 0,
        channelId: channel.channelId
      } : null;
      result.push({
        channelId: channel.channelId,
        channelVolume: channel.channelVolume,
        loadedPadRef: channel.loadedPadRef ? { ...channel.loadedPadRef } : null,
        isPlaying: channel.isPlaying,
        isPaused: channel.isPaused,
        playheadMs: channel.playheadMs,
        durationMs: channel.durationMs,
        hotcuesMs: this.cloneHotcues(channel.hotcuesMs),
        hasLocalHotcueOverride: channel.hasLocalHotcueOverride,
        collapsed: channel.collapsed,
        waveformKey: channel.waveformKey,
        pad
      });
    }
    return result;
  }

  getChannelStates() {
    return this.getDeckChannelStates();
  }

  setChannelVolume(channelId: number, volume: number) {
    const safe = Math.max(0, Math.min(1, volume));
    const current = this.getChannelVolume(channelId);
    if (Math.abs(current - safe) < 0.001) return;
    this.channelVolumes.set(channelId, safe);
    const channel = this.getDeckChannel(channelId);
    if (channel) {
      channel.channelVolume = safe;
      this.syncDeckChannelVolume(channel);
    }
    this.notifyStateChange();
  }

  getChannelVolume(channelId: number) {
    const channel = this.getDeckChannel(channelId);
    if (channel) return channel.channelVolume;
    return this.channelVolumes.get(channelId) ?? 1;
  }

  stopChannel(channelId: number, mode: StopMode = 'instant') {
    const channel = this.getDeckChannel(channelId);
    if (!channel) return;
    this.stopDeckChannelInternal(channel, mode);
  }

  stopAllPads(mode: StopMode = 'instant'): void {
    this.audioInstances.forEach(instance => {
      if (instance.isPlaying) this.stopPad(instance.padId, mode);
    });
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      this.stopChannel(i, mode);
    }
  }

  setGlobalMute(muted: boolean): void {
    this.globalMuted = muted;
    this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
    for (let i = 1; i <= this.deckChannelCount; i += 1) {
      const channel = this.getDeckChannel(i);
      if (channel) this.syncDeckChannelVolume(channel);
    }
    this.notifyStateChange();
  }

  setMasterVolume(volume: number): void {
    const safe = Math.max(0, Math.min(1, volume));
    this.pendingMasterVolume = safe;
    if (this.masterVolumeRafId !== null) return;

    this.masterVolumeRafId = requestAnimationFrame(() => {
      this.masterVolumeRafId = null;
      const next = this.pendingMasterVolume;
      this.pendingMasterVolume = null;
      if (typeof next !== 'number') return;
      if (Math.abs(this.masterVolume - next) < 0.0001) return;

      this.masterVolume = next;
      if (this.sharedIOSGainNode && this.audioContext) {
        const now = this.audioContext.currentTime;
        const timing = this.getStopTimingProfile();
        this.sharedIOSGainNode.gain.cancelScheduledValues(now);
        this.sharedIOSGainNode.gain.setTargetAtTime(next, now, timing.masterSmoothingSec);
      }
      if (!this.isIOS) {
        this.audioInstances.forEach(instance => this.updateInstanceVolume(instance));
      }
      for (let i = 1; i <= this.deckChannelCount; i += 1) {
        const channel = this.getDeckChannel(i);
        if (channel) this.syncDeckChannelVolume(channel);
      }
      this.notifyStateChange();
    });
  }

  applyGlobalEQ(eqSettings: EqSettings): void {
    this.pendingGlobalEQ = {
      low: eqSettings.low,
      mid: eqSettings.mid,
      high: eqSettings.high
    };
    if (this.eqRafId !== null) return;

    this.eqRafId = requestAnimationFrame(() => {
      this.eqRafId = null;
      const pending = this.pendingGlobalEQ;
      this.pendingGlobalEQ = null;
      if (!pending) return;

      const unchanged =
        this.globalEQ.low === pending.low &&
        this.globalEQ.mid === pending.mid &&
        this.globalEQ.high === pending.high;
      if (unchanged) return;

      this.globalEQ = pending;
      this.audioInstances.forEach(instance => this.updateInstanceEQ(instance));
      for (let i = 1; i <= this.deckChannelCount; i += 1) {
        const channel = this.getDeckChannel(i);
        if (channel) this.updateDeckChannelEQ(channel);
      }
    });
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
    stopPad: (padId: string, mode?: StopMode, keepChannel?: boolean) =>
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
    getDeckChannelStates: () =>
      globalPlaybackManager.getDeckChannelStates(),
    loadPadToChannel: (channelId: number, padId: string) =>
      globalPlaybackManager.loadPadToChannel(channelId, padId),
    unloadChannel: (channelId: number) =>
      globalPlaybackManager.unloadChannel(channelId),
    playChannel: (channelId: number) =>
      globalPlaybackManager.playChannel(channelId),
    pauseChannel: (channelId: number) =>
      globalPlaybackManager.pauseChannel(channelId),
    seekChannel: (channelId: number, ms: number) =>
      globalPlaybackManager.seekChannel(channelId, ms),
    setChannelHotcue: (channelId: number, slotIndex: number, ms: number | null) =>
      globalPlaybackManager.setChannelHotcue(channelId, slotIndex, ms),
    clearChannelHotcue: (channelId: number, slotIndex: number) =>
      globalPlaybackManager.clearChannelHotcue(channelId, slotIndex),
    triggerChannelHotcue: (channelId: number, slotIndex: number) =>
      globalPlaybackManager.triggerChannelHotcue(channelId, slotIndex),
    setChannelCollapsed: (channelId: number, collapsed: boolean) =>
      globalPlaybackManager.setChannelCollapsed(channelId, collapsed),
    setChannelCount: (count: number) =>
      globalPlaybackManager.setChannelCount(count),
    getChannelCount: () =>
      globalPlaybackManager.getChannelCount(),
    resetDeckPlaybackToStart: () =>
      globalPlaybackManager.resetDeckPlaybackToStart(),
    hydrateDeckLayout: (deckState: Array<{ channelId: number; loadedPadRef: DeckLoadedPadRef | null; hotcuesMs?: HotcueTuple; collapsed?: boolean; channelVolume?: number }>) =>
      globalPlaybackManager.hydrateDeckLayout(deckState),
    persistDeckLayoutSnapshot: () =>
      globalPlaybackManager.persistDeckLayoutSnapshot(),
    saveChannelHotcuesToPad: (channelId: number) =>
      globalPlaybackManager.saveChannelHotcuesToPad(channelId),
    setChannelVolume: (channelId: number, volume: number) =>
      globalPlaybackManager.setChannelVolume(channelId, volume),
    getChannelVolume: (channelId: number) =>
      globalPlaybackManager.getChannelVolume(channelId),
    stopChannel: (channelId: number, mode?: StopMode) =>
      globalPlaybackManager.stopChannel(channelId, mode),
    stopAllPads: (mode?: StopMode) =>
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
