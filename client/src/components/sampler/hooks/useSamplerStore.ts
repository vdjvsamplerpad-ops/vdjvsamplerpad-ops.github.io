import * as React from 'react';
import JSZip from 'jszip';
import lamejs from 'lamejs';
import { PadData, SamplerBank, BankMetadata } from '../types/sampler';
import { 
  derivePassword, 
  encryptZip, 
  decryptZip, 
  isZipPasswordMatch,
  getDerivedKey, 
  createAdminBankWithDerivedKey, 
  addBankMetadata, 
  extractBankMetadata,
  hasBankAccess,
  keyCache,
  parseBankIdFromFileName,
  listAccessibleBankIds,
  getCachedBankKeysForUser,
  resolveAdminBankMetadata,
  pruneProtectedBanksFromCache
} from '@/lib/bank-utils';
import { useAuth, getCachedUser } from '@/hooks/useAuth';
import { ensureActivityRuntime, logActivityEvent } from '@/lib/activityLogger';

// Helper to detect if running in native Android app (not web browser)
const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isAndroid = /Android/.test(ua);
  // Check if Capacitor is available and we're in native platform
  const capacitor = (window as any).Capacitor;
  return isAndroid && capacitor?.isNativePlatform?.() === true;
};

// Helper to save file using Capacitor Filesystem or standard download
// Returns object with success status and message
const saveBankFile = async (blob: Blob, fileName: string): Promise<{ success: boolean; message?: string; savedPath?: string }> => {
  if (isNativeAndroid()) {
    try {
      // Use Capacitor Filesystem for native Android
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      
      // Convert blob to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Remove data URL prefix (e.g., "data:application/zip;base64,")
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      
      // Save to Documents directory
      await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Documents,
        recursive: true
      });
      
      console.log(`✅ Bank saved to Documents/${fileName}`);
      return { 
        success: true, 
        message: 'Successfully exported, saved to Documents',
        savedPath: `Documents/${fileName}`
      };
    } catch (error) {
      console.error('❌ Failed to save using Capacitor Filesystem, falling back to download:', error);
      // Fall through to standard download
    }
  }
  
  // Standard web download (works for web browsers and Electron)
  const isElectron = typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  // For web/Electron, the browser handles the save location
  // We can't know the exact path, but we know it was saved to the selected/download location
  return { 
    success: true,
    message: isElectron ? `Successfully exported in 'selected path'` : `Successfully exported in 'selected path'`,
    savedPath: fileName
  };
};

interface SamplerStore {
  banks: SamplerBank[];
  primaryBankId: string | null;
  secondaryBankId: string | null;
  currentBankId: string | null;
  primaryBank: SamplerBank | null;
  secondaryBank: SamplerBank | null;
  currentBank: SamplerBank | null;
  isDualMode: boolean;
  addPad: (file: File, bankId?: string) => void;
  addPads: (files: File[], bankId?: string) => Promise<void>;
  updatePad: (bankId: string, id: string, updatedPad: PadData) => void;
  removePad: (bankId: string, id: string) => void;
  createBank: (name: string, defaultColor: string) => void;
  setPrimaryBank: (id: string | null) => void;
  setSecondaryBank: (id: string | null) => void;
  setCurrentBank: (id: string | null) => void;
  updateBank: (id: string, updates: Partial<SamplerBank>) => void;
  deleteBank: (id: string) => void;
  importBank: (file: File, onProgress?: (progress: number) => void) => Promise<SamplerBank | null>;
  exportBank: (id: string, onProgress?: (progress: number) => void) => Promise<string>;
  reorderPads: (bankId: string, fromIndex: number, toIndex: number) => void;
  moveBankUp: (id: string) => void;
  moveBankDown: (id: string) => void;
  transferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  exportAdminBank: (id: string, title: string, description: string, transferable: boolean, addToDatabase: boolean, allowExport: boolean, onProgress?: (progress: number) => void) => Promise<string>;
  canTransferFromBank: (bankId: string) => boolean;
}

const STORAGE_KEY = 'vdjv-sampler-banks';
const STATE_STORAGE_KEY = 'vdjv-sampler-state';
const DEFAULT_BANK_LOADED_KEY = 'vdjv-default-bank-loaded';
const DEFAULT_BANK_LOADING_LOCK_KEY = 'vdjv-default-bank-loading-lock';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';

// Shared encryption password for banks with "Allow Export" disabled
// This provides security layer without requiring Supabase or user purchase
// All users (logged in or not) can import these banks
const SHARED_EXPORT_DISABLED_PASSWORD = 'vdjv-export-disabled-2024-secure';

const getLocalStorageItemSafe = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`localStorage.getItem failed for key "${key}"`, error);
    return null;
  }
};

const setLocalStorageItemSafe = (key: string, value: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`localStorage.setItem failed for key "${key}"`, error);
    return false;
  }
};

// File System Access API support check
const supportsFileSystemAccess = () => {
  return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'FileSystemFileHandle' in window;
};

// IndexedDB setup for file handles and blob storage
const openFileDB = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable in this browser context'));
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open('vdjv-file-storage', 4);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains('file-handles')) db.createObjectStore('file-handles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('image-handles')) db.createObjectStore('image-handles', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quota-info')) db.createObjectStore('quota-info', { keyPath: 'type' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const MAX_IMAGE_QUOTA = 50 * 1024 * 1024; // 50MB

// --- OPTIMIZATION: BATCH DATABASE OPERATIONS ---

interface BatchFileItem {
  id: string;
  blob: Blob;
  type: 'audio' | 'image';
}

const saveBatchBlobsToDB = async (items: BatchFileItem[]) => {
  if (items.length === 0) return;
  
  try {
    const db = await openFileDB();
    
    // Calculate image size for quota check
    let totalImageSize = 0;
    items.forEach(item => {
      if (item.type === 'image') totalImageSize += item.blob.size;
    });

    if (totalImageSize > 0) {
      const currentUsage = await getCurrentQuotaUsage();
      if (currentUsage + totalImageSize > MAX_IMAGE_QUOTA) {
        throw new Error('Pad image storage is full. Delete some pad images before adding another.');
      }
    }

    return new Promise<void>((resolve, reject) => {
      // Open ONE transaction for all files
      const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
      const blobStore = tx.objectStore('blobs');
      const quotaStore = tx.objectStore('quota-info');

      // 1. Process all saves
      items.forEach(item => {
        const storeId = `${item.type}_${item.id}`; // Construct proper ID key
        blobStore.put({ id: storeId, blob: item.blob, timestamp: Date.now() });
      });

      // 2. Process Quota Update (once)
      if (totalImageSize > 0) {
        const quotaRequest = quotaStore.get('images');
        quotaRequest.onsuccess = () => {
          const current = quotaRequest.result?.usage || 0;
          quotaStore.put({ type: 'images', usage: current + totalImageSize });
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('Failed to save batch blobs:', error);
    throw error;
  }
};

// --- END OPTIMIZATION ---

// Quota tracking helpers
const getCurrentQuotaUsage = async (): Promise<number> => {
  try {
    const db = await openFileDB();
    return new Promise((resolve) => {
      const tx = db.transaction('quota-info', 'readonly');
      const request = tx.objectStore('quota-info').get('images');
      request.onsuccess = () => resolve(request.result?.usage || 0);
      request.onerror = () => resolve(0);
    });
  } catch (error) { return 0; }
};

const saveFileHandle = async (id: string, handle: FileSystemFileHandle, type: 'audio' | 'image' = 'audio') => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put({ id, handle, type, timestamp: Date.now() });
  } catch (e) {}
};

const getFileHandle = async (id: string, type: 'audio' | 'image' = 'audio'): Promise<FileSystemFileHandle | null> => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    return new Promise((resolve) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result ? request.result.handle : null);
      request.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
};

const deleteFileHandle = async (id: string, type: 'audio' | 'image' = 'audio') => {
  try {
    const db = await openFileDB();
    const storeName = type === 'image' ? 'image-handles' : 'file-handles';
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
  } catch (e) {}
};

const saveBlobToDB = async (id: string, blob: Blob, isImage: boolean = false) => {
  try {
    const db = await openFileDB();
    if (isImage) {
      const currentUsage = await getCurrentQuotaUsage();
      if (currentUsage + blob.size > MAX_IMAGE_QUOTA) throw new Error('Storage full');
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
      tx.objectStore('blobs').put({ id, blob, timestamp: Date.now() });
      if (isImage) {
        const qs = tx.objectStore('quota-info');
        const req = qs.get('images');
        req.onsuccess = () => qs.put({ type: 'images', usage: (req.result?.usage || 0) + blob.size });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { throw e; }
};

const getBlobFromDB = async (id: string): Promise<Blob | null> => {
  try {
    const db = await openFileDB();
    return new Promise((resolve) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.blob : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) { return null; }
};

const deleteBlobFromDB = async (id: string, isImage: boolean = false) => {
  try {
    const db = await openFileDB();
    const tx = db.transaction(['blobs', 'quota-info'], 'readwrite');
    const store = tx.objectStore('blobs');
    if (isImage) {
      const req = store.get(id);
      req.onsuccess = () => {
        const size = req.result?.blob?.size || 0;
        store.delete(id);
        if (size > 0) {
          const qs = tx.objectStore('quota-info');
          const qr = qs.get('images');
          qr.onsuccess = () => qs.put({ type: 'images', usage: Math.max(0, (qr.result?.usage || 0) - size) });
        }
      };
    } else {
      store.delete(id);
    }
  } catch (e) {}
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader(); r.readAsDataURL(file); r.onload = () => resolve(r.result as string); r.onerror = reject;
});

const base64ToBlob = (base64: string): Blob => {
  const arr = base64.split(','), mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]); let n = bstr.length; const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new Blob([u8arr], { type: mime });
};

const generateId = (): string => Date.now().toString(36) + Math.random().toString(36).substr(2);

// --- AUDIO TRIMMING HELPER FUNCTIONS ---

const detectAudioFormat = (blob: Blob): 'mp3' | 'wav' | 'ogg' | 'unknown' => {
  const type = blob.type.toLowerCase();
  if (type.includes('mp3') || type.includes('mpeg')) return 'mp3';
  if (type.includes('wav') || type.includes('wave')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  return 'unknown';
};

const audioBufferToWavBlob = (audioBuffer: AudioBuffer): Blob => {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const bufferSize = 44 + dataSize;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

const encodeAudioBufferToMP3 = (audioBuffer: AudioBuffer, bitrate: number = 128): { blob: Blob; format: 'mp3' | 'wav' } => {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  try {
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
    const convertToInt16 = (samples: Float32Array): Int16Array => {
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return int16;
    };
    const leftInt16 = convertToInt16(leftChannel);
    const rightInt16 = convertToInt16(rightChannel);
    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const mp3Data: Int8Array[] = [];
    const sampleBlockSize = 1152;
    for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
      const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
      const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
      let mp3buf: Int8Array;
      if (numChannels === 1) mp3buf = mp3encoder.encodeBuffer(leftChunk);
      else mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) mp3Data.push(mp3buf);
    }
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) mp3Data.push(mp3buf);
    const totalLength = mp3Data.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of mp3Data) { result.set(chunk, offset); offset += chunk.length; }
    console.log('✅ MP3 encoding successful');
    return { blob: new Blob([result], { type: 'audio/mp3' }), format: 'mp3' };
  } catch (error) {
    console.warn('⚠️ MP3 encoding failed, falling back to WAV:', error);
    return { blob: audioBufferToWavBlob(audioBuffer), format: 'wav' };
  }
};

const trimAudio = async (
  audioBlob: Blob,
  startTimeMs: number,
  endTimeMs: number,
  originalFormat: 'mp3' | 'wav' | 'ogg' | 'unknown'
): Promise<{ blob: Blob; newDurationMs: number }> => {
  console.log(`🔧 trimAudio() called: startMs=${startTimeMs}, endMs=${endTimeMs}, format=${originalFormat}`);
  const arrayBuffer = await audioBlob.arrayBuffer();
  const arrayBufferCopy = arrayBuffer.slice(0);
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioContextClass();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBufferCopy);
    const actualDurationMs = audioBuffer.duration * 1000;
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor((startTimeMs / 1000) * sampleRate);
    const endSample = Math.min(Math.floor((endTimeMs / 1000) * sampleRate), audioBuffer.length);
    const trimmedLength = endSample - startSample;
    
    if (trimmedLength <= 0) throw new Error(`Invalid trim range: trimmedLength=${trimmedLength}`);
    
    const trimmedBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, trimmedLength, sampleRate);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const originalData = audioBuffer.getChannelData(channel);
      const trimmedData = trimmedBuffer.getChannelData(channel);
      for (let i = 0; i < trimmedLength; i++) trimmedData[i] = originalData[startSample + i];
    }
    const newDurationMs = (trimmedLength / sampleRate) * 1000;
    let resultBlob: Blob;
    if (originalFormat === 'mp3') {
      const encodeResult = encodeAudioBufferToMP3(trimmedBuffer);
      resultBlob = encodeResult.blob;
    } else {
      resultBlob = audioBufferToWavBlob(trimmedBuffer);
    }
    return { blob: resultBlob, newDurationMs };
  } finally {
    await audioContext.close();
  }
};

const restoreFileAccess = async (padId: string, type: 'audio' | 'image'): Promise<string | null> => {
  const keyPrefix = type === 'image' ? 'image' : 'audio';
  const storageId = `${keyPrefix}_${padId}`;
  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(storageId, type);
      if (handle && ((await (handle as any).queryPermission?.()) === 'granted' || (await (handle as any).requestPermission?.()) === 'granted')) {
        return URL.createObjectURL(await handle.getFile());
      }
    } catch (e) {}
  }
  try {
    const blob = await getBlobFromDB(storageId);
    if (blob) return URL.createObjectURL(blob);
  } catch (e) {}
  return null;
};

const storeFile = async (padId: string, file: File, type: 'audio' | 'image'): Promise<void> => {
  const keyPrefix = type === 'image' ? 'image' : 'audio';
  const storageId = `${keyPrefix}_${padId}`;
  await saveBlobToDB(storageId, file, type === 'image');
};

export function useSamplerStore(): SamplerStore {
  const { user, profile, loading, sessionConflictReason } = useAuth();
  const [banks, setBanks] = React.useState<SamplerBank[]>([]);
  const [primaryBankId, setPrimaryBankIdState] = React.useState<string | null>(null);
  const [secondaryBankId, setSecondaryBankIdState] = React.useState<string | null>(null);
  const [currentBankId, setCurrentBankIdState] = React.useState<string | null>(null);
  // Note: Default bank loading is now triggered by user login, not a separate state

  const primaryBank = React.useMemo(() => banks.find(b => b.id === primaryBankId) || null, [banks, primaryBankId]);
  const secondaryBank = React.useMemo(() => banks.find(b => b.id === secondaryBankId) || null, [banks, secondaryBankId]);
  const currentBank = React.useMemo(() => banks.find(b => b.id === currentBankId) || null, [banks, currentBankId]);
  const isDualMode = React.useMemo(() => primaryBankId !== null, [primaryBankId]);
  const hiddenProtectedBanksRef = React.useRef<SamplerBank[]>([]);
  const attemptedDefaultLoadUserRef = React.useRef<string | null>(null);

  const isProtectedBanksLockActive = React.useCallback(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(HIDE_PROTECTED_BANKS_KEY) === '1';
    } catch {
      return false;
    }
  }, []);

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      setLocalStorageItemSafe(
        STATE_STORAGE_KEY,
        JSON.stringify({ primaryBankId, secondaryBankId, currentBankId })
      );
    }
  }, [primaryBankId, secondaryBankId, currentBankId]);

  React.useEffect(() => {
    ensureActivityRuntime();
  }, []);

  const logExportActivity = React.useCallback((input: {
    status: 'success' | 'failed';
    bankName: string;
    bankId?: string;
    padNames: string[];
    errorMessage?: string;
  }) => {
    const effectiveUser = user || getCachedUser();
    void logActivityEvent({
      eventType: 'bank.export',
      status: input.status,
      userId: effectiveUser?.id || null,
      email: effectiveUser?.email || 'unknown',
      bankId: input.bankId || null,
      bankName: input.bankName,
      padCount: input.padNames.length,
      padNames: input.padNames,
      errorMessage: input.errorMessage || null,
      meta: {
        source: 'useSamplerStore.exportBank',
        includePadList: true,
      },
    }).catch((err) => {
      console.warn('Failed to log export activity:', err);
    });
  }, [user]);

  const logImportActivity = React.useCallback((input: {
    status: 'success' | 'failed';
    bankName: string;
    bankId?: string;
    padNames: string[];
    includePadList: boolean;
    errorMessage?: string;
  }) => {
    const effectiveUser = user || getCachedUser();
    void logActivityEvent({
      eventType: 'bank.import',
      status: input.status,
      userId: effectiveUser?.id || null,
      email: effectiveUser?.email || 'unknown',
      bankId: input.bankId || null,
      bankName: input.bankName,
      padCount: input.padNames.length,
      padNames: input.includePadList ? input.padNames : [],
      errorMessage: input.errorMessage || null,
      meta: {
        source: 'useSamplerStore.importBank',
        includePadList: input.includePadList,
      },
    }).catch((err) => {
      console.warn('Failed to log import activity:', err);
    });
  }, [user]);

  const hideProtectedBanks = React.useCallback(() => {
    setBanks((prev) => {
      const next = pruneProtectedBanksFromCache(prev);
      if (next.length === prev.length) return prev;
      const visibleIds = new Set(next.map((bank) => bank.id));
      hiddenProtectedBanksRef.current = prev.filter((bank) => !visibleIds.has(bank.id));
      const nextIds = new Set(next.map((bank) => bank.id));
      setPrimaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
      setSecondaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
      setCurrentBankIdState((current) => {
        if (current && nextIds.has(current)) return current;
        return next[0]?.id || null;
      });
      return next;
    });
  }, []);

  const restoreHiddenProtectedBanks = React.useCallback(() => {
    const hidden = hiddenProtectedBanksRef.current;
    if (!hidden.length) return;
    setBanks((prev) => {
      const existing = new Set(prev.map((bank) => bank.id));
      const toRestore = hidden.filter((bank) => !existing.has(bank.id));
      if (!toRestore.length) {
        hiddenProtectedBanksRef.current = [];
        return prev;
      }
      hiddenProtectedBanksRef.current = [];
      return [...prev, ...toRestore].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    });
  }, []);

  const restoreAllFiles = React.useCallback(async () => {
    if (typeof window === 'undefined') return;
    const savedData = getLocalStorageItemSafe(STORAGE_KEY);
    const savedState = getLocalStorageItemSafe(STATE_STORAGE_KEY);

    if (!savedData) {
      // No saved data - create empty default bank
      // Default bank loading will be triggered separately when user logs in
        const defaultBank: SamplerBank = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 };
      setBanks([defaultBank]); 
      setCurrentBankIdState(defaultBank.id);
        return;
    }
    try {
      const { banks: savedBanks } = JSON.parse(savedData);
      let restoredState = { primaryBankId: null, secondaryBankId: null, currentBankId: null };
      if (savedState) try { restoredState = JSON.parse(savedState); } catch (e) {}

      let restoredBanks = await Promise.all(savedBanks.map(async (bank: any, index: number) => {
        const restoredPads = await Promise.all(bank.pads.map(async (pad: any, index: number) => {
          const restoredPad = {
            ...pad, audioUrl: null, imageUrl: null, fadeInMs: pad.fadeInMs || 0, fadeOutMs: pad.fadeOutMs || 0,
            startTimeMs: pad.startTimeMs || 0, endTimeMs: pad.endTimeMs || 0, pitch: pad.pitch || 0, position: pad.position ?? index,
          };
          try {
            const audioUrl = await restoreFileAccess(pad.id, 'audio');
            if (audioUrl) restoredPad.audioUrl = audioUrl;
          } catch (e) {}
          try {
            const imageUrl = await restoreFileAccess(pad.id, 'image');
            if (imageUrl) restoredPad.imageUrl = imageUrl;
            else if (pad.imageData) {
              try { restoredPad.imageUrl = URL.createObjectURL(base64ToBlob(pad.imageData)); } catch (e) {}
            }
          } catch (e) {}
          return restoredPad;
        }));
        return { ...bank, createdAt: new Date(bank.createdAt), sortOrder: bank.sortOrder ?? index, pads: restoredPads };
      }));
      const hideProtectedLock =
        typeof window !== 'undefined' && localStorage.getItem(HIDE_PROTECTED_BANKS_KEY) === '1';
      if (hideProtectedLock) {
        const visible = pruneProtectedBanksFromCache(restoredBanks);
        hiddenProtectedBanksRef.current = restoredBanks.filter(
          (bank) => !visible.some((visibleBank) => visibleBank.id === bank.id)
        );
        restoredBanks = visible;
      }
      restoredBanks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      setBanks(restoredBanks);
      setPrimaryBankIdState(restoredState.primaryBankId);
      setSecondaryBankIdState(restoredState.secondaryBankId);
      if (restoredState.currentBankId && restoredBanks.find(b => b.id === restoredState.currentBankId)) setCurrentBankIdState(restoredState.currentBankId);
      else if (restoredBanks.length > 0) setCurrentBankIdState(restoredBanks[0].id);
    } catch (error) {
       const defaultBank: SamplerBank = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 };
       setBanks([defaultBank]); setCurrentBankIdState(defaultBank.id);
    }
  }, []);

  React.useEffect(() => { restoreAllFiles(); }, [restoreAllFiles]);

  React.useEffect(() => {
    if (loading) return;
    if (user) return;
    hideProtectedBanks();
  }, [user?.id, loading, hideProtectedBanks]);

  React.useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (isProtectedBanksLockActive()) return;
    restoreHiddenProtectedBanks();
  }, [user?.id, loading, isProtectedBanksLockActive, restoreHiddenProtectedBanks]);

  React.useEffect(() => {
    if (!sessionConflictReason) return;
    hideProtectedBanks();
  }, [sessionConflictReason, hideProtectedBanks]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_ENFORCEMENT_EVENT_KEY || !event.newValue) return;
      hideProtectedBanks();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [hideProtectedBanks]);

  React.useEffect(() => {
    if (typeof window !== 'undefined' && banks.length > 0) {
      if (isProtectedBanksLockActive()) return;
      try {
        const dataToSave = {
          banks: banks.map(bank => ({
            ...bank,
            pads: bank.pads.map(pad => ({
              ...pad, audioUrl: undefined, imageUrl: undefined, imageData: undefined,
            }))
          }))
        };
        const dataString = JSON.stringify(dataToSave);
        if (dataString.length > 4 * 1024 * 1024) {
           const reducedData = {
            banks: banks.map(bank => ({
              ...bank, pads: bank.pads.map(pad => ({
                id: pad.id,
                name: pad.name,
                color: pad.color,
                shortcutKey: pad.shortcutKey,
                midiNote: pad.midiNote,
                midiCC: pad.midiCC,
                triggerMode: pad.triggerMode,
                playbackMode: pad.playbackMode,
                volume: pad.volume,
                fadeInMs: pad.fadeInMs,
                fadeOutMs: pad.fadeOutMs,
                startTimeMs: pad.startTimeMs,
                endTimeMs: pad.endTimeMs,
                pitch: pad.pitch,
                position: pad.position,
                ignoreChannel: pad.ignoreChannel
              }))
            }))
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(reducedData));
        } else {
          localStorage.setItem(STORAGE_KEY, dataString);
        }
      } catch (e) {}
    }
  }, [banks]);

  const getTargetBankId = React.useCallback((bankId?: string): string | null => {
    if (bankId) return bankId;
    if (isDualMode && secondaryBankId) return secondaryBankId;
    if (isDualMode && primaryBankId) return primaryBankId;
    return currentBankId;
  }, [isDualMode, primaryBankId, secondaryBankId, currentBankId]);

  const trimPadName = React.useCallback((name: string) => name.slice(0, 32), []);

  const addPad = React.useCallback(async (file: File, bankId?: string) => {
    const targetBankId = getTargetBankId(bankId);
    if (!targetBankId) return;
    const targetBank = banks.find(b => b.id === targetBankId);
    if (!targetBank) return;
    try {
      const padId = generateId();
      const audioUrl = URL.createObjectURL(file);
      await storeFile(padId, file, 'audio');
      const maxPosition = targetBank.pads.length > 0 ? Math.max(...targetBank.pads.map(p => p.position || 0)) : -1;
      const newPad: PadData = {
        id: padId,
        name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
        audioUrl,
        color: targetBank.defaultColor,
        triggerMode: 'toggle',
        playbackMode: 'once',
        volume: 1,
        fadeInMs: 0,
        fadeOutMs: 0,
        startTimeMs: 0,
        endTimeMs: 0,
        pitch: 0,
        position: maxPosition + 1,
        ignoreChannel: false
      };
      const audio = new Audio(audioUrl);
      audio.addEventListener('loadedmetadata', () => {
        newPad.endTimeMs = audio.duration * 1000;
        if (audio.duration > 0 && audio.duration < 15) {
          newPad.ignoreChannel = true;
        }
        setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, newPad] } : b));
      });
      setTimeout(() => { if (newPad.endTimeMs === 0) { newPad.endTimeMs = 30000; setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, newPad] } : b)); } }, 1000);
    } catch (e) { throw e; }
  }, [banks, getTargetBankId, trimPadName]);

  const addPads = React.useCallback(async (files: File[], bankId?: string) => {
    const targetBankId = getTargetBankId(bankId);
    if (!targetBankId) return;
    const targetBank = banks.find(b => b.id === targetBankId);
    if (!targetBank) return;
    try {
      const validFiles = files.filter(file => file.type.startsWith('audio/'));
      if (validFiles.length === 0) return;

      const batchItems: BatchFileItem[] = [];
      const newPads: PadData[] = [];
      let maxPosition = targetBank.pads.length > 0 ? Math.max(...targetBank.pads.map(p => p.position || 0)) : -1;

      for (const file of validFiles) {
        if (file.size > 50 * 1024 * 1024) continue;
        const padId = generateId();
        const audioUrl = URL.createObjectURL(file);
        
        batchItems.push({ id: padId, blob: file, type: 'audio' });
        
        maxPosition++;
        const newPad: PadData = {
          id: padId,
          name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
          audioUrl,
          color: targetBank.defaultColor,
          triggerMode: 'toggle',
          playbackMode: 'once',
          volume: 1,
          fadeInMs: 0,
          fadeOutMs: 0,
          startTimeMs: 0,
          endTimeMs: 0,
          pitch: 0,
          position: maxPosition,
          ignoreChannel: false
        };
        newPads.push(newPad);
        
        const audio = new Audio(audioUrl);
        audio.addEventListener('loadedmetadata', () => {
          newPad.endTimeMs = audio.duration * 1000;
          if (audio.duration > 0 && audio.duration < 15) {
            newPad.ignoreChannel = true;
          }
          setBanks(p => [...p]);
        });
      }

      if (batchItems.length > 0) {
        await saveBatchBlobsToDB(batchItems);
        setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, ...newPads] } : b));
      }
    } catch (e) { throw e; }
  }, [banks, getTargetBankId, trimPadName]);

  const updatePad = React.useCallback(async (bankId: string, id: string, updatedPad: PadData) => {
    if (updatedPad.imageData && updatedPad.imageData.startsWith('data:')) {
      try {
        const imageBlob = base64ToBlob(updatedPad.imageData);
        if (updatedPad.imageUrl && updatedPad.imageUrl.startsWith('blob:')) URL.revokeObjectURL(updatedPad.imageUrl);
        updatedPad.imageUrl = URL.createObjectURL(imageBlob);
        await storeFile(id, new File([imageBlob], 'image', { type: imageBlob.type }), 'image');
        updatedPad.imageData = undefined;
      } catch (e) {}
    }
    setBanks(prev => prev.map(b => b.id === bankId ? { ...b, pads: b.pads.map(pad => pad.id === id ? updatedPad : pad) } : b));
  }, []);

  const removePad = React.useCallback(async (bankId: string, id: string) => {
    try { await Promise.all([deleteBlobFromDB(`audio_${id}`, false), deleteBlobFromDB(`image_${id}`, true), deleteFileHandle(`audio_${id}`, 'audio'), deleteFileHandle(`image_${id}`, 'image')]); } catch (e) {}
    setBanks(prev => prev.map(b => b.id === bankId ? { ...b, pads: b.pads.filter(pad => {
        if (pad.id === id) { if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl); if (pad.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.imageUrl); }
        return pad.id !== id;
      }) } : b));
  }, []);

  const reorderPads = React.useCallback((bankId: string, fromIndex: number, toIndex: number) => {
    setBanks(prev => prev.map(bank => {
      if (bank.id !== bankId) return bank;
      const sorted = [...bank.pads].sort((a, b) => (a.position || 0) - (b.position || 0));
      const [moved] = sorted.splice(fromIndex, 1);
      sorted.splice(toIndex, 0, moved);
      return { ...bank, pads: sorted.map((p, i) => ({ ...p, position: i })) };
    }));
  }, []);

  const createBank = React.useCallback((name: string, defaultColor: string) => {
    const maxSort = banks.length > 0 ? Math.max(...banks.map(b => b.sortOrder || 0)) : -1;
    const newBank: SamplerBank = { id: generateId(), name, defaultColor, pads: [], createdAt: new Date(), sortOrder: maxSort + 1 };
    setBanks(prev => [...prev, newBank]);
    if (!currentBankId && !isDualMode) setCurrentBankIdState(newBank.id);
  }, [banks, currentBankId, isDualMode]);

  const moveBankUp = React.useCallback((id: string) => {
    setBanks(prev => {
      const sorted = [...prev].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const idx = sorted.findIndex(b => b.id === id);
      if (idx <= 0) return prev;
      const t = sorted[idx - 1].sortOrder; sorted[idx - 1].sortOrder = sorted[idx].sortOrder; sorted[idx].sortOrder = t;
      return sorted;
    });
  }, []);

  const moveBankDown = React.useCallback((id: string) => {
    setBanks(prev => {
      const sorted = [...prev].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const idx = sorted.findIndex(b => b.id === id);
      if (idx >= sorted.length - 1 || idx === -1) return prev;
      const t = sorted[idx + 1].sortOrder; sorted[idx + 1].sortOrder = sorted[idx].sortOrder; sorted[idx].sortOrder = t;
      return sorted;
    });
  }, []);

  const transferPad = React.useCallback((padId: string, sourceBankId: string, targetBankId: string) => {
    setBanks(prev => {
      const src = prev.find(b => b.id === sourceBankId), tgt = prev.find(b => b.id === targetBankId);
      if (!src || !tgt) return prev;
      const pad = src.pads.find(p => p.id === padId);
      if (!pad) return prev;
      const maxPos = tgt.pads.length > 0 ? Math.max(...tgt.pads.map(p => p.position || 0)) : -1;
      const upPad = { ...pad, position: maxPos + 1, color: tgt.defaultColor };
      return prev.map(b => {
        if (b.id === sourceBankId) return { ...b, pads: b.pads.filter(p => p.id !== padId) };
        if (b.id === targetBankId) return { ...b, pads: [...b.pads, upPad] };
        return b;
      });
    });
  }, []);

  const setPrimaryBank = React.useCallback((id: string | null) => {
    if (id === null) { if (primaryBankId) setCurrentBankIdState(primaryBankId); setPrimaryBankIdState(null); setSecondaryBankIdState(null); }
    else if (id === primaryBankId) { setCurrentBankIdState(primaryBankId); setPrimaryBankIdState(null); setSecondaryBankIdState(null); }
    else { setPrimaryBankIdState(id); if (id === secondaryBankId) setSecondaryBankIdState(null); if (currentBankId && currentBankId !== id) setSecondaryBankIdState(currentBankId); setCurrentBankIdState(null); }
  }, [primaryBankId, secondaryBankId, currentBankId]);

  const setSecondaryBank = React.useCallback((id: string | null) => { if (primaryBankId && id !== primaryBankId) setSecondaryBankIdState(id); }, [primaryBankId]);
  const setCurrentBank = React.useCallback((id: string | null) => { if (!isDualMode) setCurrentBankIdState(id); }, [isDualMode]);
  
  const updateBank = React.useCallback((id: string, updates: Partial<SamplerBank>) => {
    setBanks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  }, []);

  const deleteBank = React.useCallback(async (id: string) => {
    setBanks(prev => {
      const toDel = prev.find(b => b.id === id);
      if (toDel) { toDel.pads.forEach(async p => { try { await Promise.all([deleteBlobFromDB(`audio_${p.id}`, false), deleteBlobFromDB(`image_${p.id}`, true)]); if (p.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(p.audioUrl); if (p.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(p.imageUrl); } catch (e) {} }); }
      const newBanks = prev.filter(b => b.id !== id);
      if (id === primaryBankId) { setPrimaryBankIdState(null); setSecondaryBankIdState(null); if (newBanks.length > 0) setCurrentBankIdState(newBanks[0].id); }
      else if (id === secondaryBankId) setSecondaryBankIdState(null);
      else if (id === currentBankId) setCurrentBankIdState(newBanks.length > 0 ? newBanks[0].id : null);
      if (newBanks.length === 0) { const d = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 }; setCurrentBankIdState(d.id); return [d]; }
      return newBanks;
    });
  }, [primaryBankId, secondaryBankId, currentBankId]);

  // --- FIXED EXPORT BANK (Prevents Audio Bloat) ---
  const exportBank = React.useCallback(async (id: string, onProgress?: (progress: number) => void) => {
    const bank = banks.find(b => b.id === id);
    if (!bank) throw new Error('Bank not found');
    
    // Block export if exportable is false
    if (bank.exportable === false) {
      throw new Error('Export is disabled for this bank');
    }
    
    try {
      const zip = new JSZip();
      
      const exportPads = bank.pads.map(pad => ({
        ...pad,
        audioUrl: pad.audioUrl ? `audio/${pad.id}.audio` : undefined,
        imageUrl: pad.imageUrl ? `images/${pad.id}.image` : undefined,
      }));
      
      const bankData = { 
        ...bank, 
        createdAt: bank.createdAt.toISOString(), 
        pads: exportPads,
        creatorEmail: user?.email || undefined,
      };
      
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      const totalFiles = bank.pads.filter(p => p.audioUrl).length + bank.pads.filter(p => p.imageUrl).length;
      let processedFiles = 0;
      
      if (audioFolder) {
        for (let i = 0; i < bank.pads.length; i++) {
          const pad = bank.pads[i];
          if (pad.audioUrl) {
            onProgress && onProgress((processedFiles / totalFiles) * 60);
            try {
              let audioBlob = await (await fetch(pad.audioUrl)).blob();
              const originalSize = audioBlob.size;
              
              // Get actual audio duration to detect trim-out
              let actualDurationMs = 0;
              try {
                const arrayBuffer = await audioBlob.arrayBuffer();
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                const tempContext = new AudioContextClass();
                const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0)); 
                actualDurationMs = audioBuffer.duration * 1000;
                tempContext.close();
                audioBlob = await (await fetch(pad.audioUrl)).blob(); // Reset blob
              } catch (e) {
                console.warn('Could not get actual duration, assuming no trim out needed:', e);
                actualDurationMs = pad.endTimeMs + 1000; // Fake it so check fails safe
              }
              
              // LOGIC FIX: Check if trim is actually needed
              const hasTrimIn = pad.startTimeMs > 50; // Tolerance for float/UI
              const hasTrimOut = pad.endTimeMs > 0 && (actualDurationMs - pad.endTimeMs) > 200; // Tolerance
              const isTrimmed = hasTrimIn || hasTrimOut;

              if (isTrimmed && pad.endTimeMs > pad.startTimeMs) {
                console.log(`🎵 Export: Pad "${pad.name}" IS trimmed. Processing...`);
                const format = detectAudioFormat(audioBlob);
                try {
                  const trimResult = await trimAudio(audioBlob, pad.startTimeMs, pad.endTimeMs, format);
                  audioBlob = trimResult.blob;
                  console.log(`✅ Trimmed "${pad.name}" - original: ${(originalSize / 1024).toFixed(1)}KB, new: ${(audioBlob.size / 1024).toFixed(1)}KB`);
                  
                  const exportPad = exportPads.find(p => p.id === pad.id);
                  if (exportPad) {
                    exportPad.startTimeMs = 0;
                    exportPad.endTimeMs = trimResult.newDurationMs; 
                  }
                } catch (trimError) {
                  console.warn(`⚠️ Trim failed for "${pad.name}", using original:`, trimError);
                }
              } else {
                 console.log(`⏩ Export: Pad "${pad.name}" is NOT trimmed. Using original file.`);
                 // Keep startTimeMs and endTimeMs in JSON as they are, so they load back correctly relative to the untrimmed file
              }
              
              audioFolder.file(`${pad.id}.audio`, audioBlob);
            } catch (e) {
              console.error('Audio export error:', e);
            }
            processedFiles++;
          }
        }
      }
      
      zip.file('bank.json', JSON.stringify(bankData, null, 2));
      
      if (imageFolder) {
        for (const pad of bank.pads) {
          if (pad.imageUrl) {
            onProgress && onProgress(60 + (processedFiles / totalFiles) * 20);
            try { const b = await (await fetch(pad.imageUrl)).blob(); imageFolder.file(`${pad.id}.image`, b); } catch (e) {}
            processedFiles++;
          }
        }
      }
      
      onProgress && onProgress(80);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }, (m) => onProgress && onProgress(80 + (m.percent * 0.2)));
      onProgress && onProgress(100);
      
      const fileName = `${bank.name.replace(/[^a-z0-9]/gi, '_')}.bank`;
      const saveResult = await saveBankFile(zipBlob, fileName);
      if (saveResult.message) {
        console.log('✅', saveResult.message);
      }
      logExportActivity({
        status: 'success',
        bankName: bank.name,
        bankId: bank.id,
        padNames: bank.pads.map((pad) => pad.name || 'Untitled Pad'),
      });
      return saveResult.message || 'Bank exported successfully';
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logExportActivity({
        status: 'failed',
        bankName: bank.name,
        bankId: bank.id,
        padNames: bank.pads.map((pad) => pad.name || 'Untitled Pad'),
        errorMessage,
      });
      throw e;
    }
  }, [banks, logExportActivity]);

  // --- FIXED IMPORT BANK ---
  const importBank = React.useCallback(async (file: File, onProgress?: (progress: number) => void) => {
    const effectiveUser = user || getCachedUser();
    let importBankName = file?.name || 'unknown.bank';
    let importPadNames: string[] = [];
    let includePadList = false;
    try {

      
      // Validate file before processing
      if (!file || file.size === 0) {
        throw new Error('Invalid file: File is empty or not accessible');
      }
      
      if (!file.name.endsWith('.bank')) {
        throw new Error('Invalid file type: File must have .bank extension');
      }
      
      const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(ms / 1000)}s`)), ms);
        });
        try {
          return await Promise.race([promise, timeoutPromise]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      const loadZipFromBlob = async (blob: Blob, label: string): Promise<JSZip> => {
        try {
          return await withTimeout(new JSZip().loadAsync(blob), adaptiveTimeoutMs, label);
        } catch (err) {
          const buffer = await blob.arrayBuffer();
          return await withTimeout(new JSZip().loadAsync(buffer), adaptiveTimeoutMs, label);
        }
      };

      const baseTimeoutMs = 60_000;
      const per100MbMs = 60_000;
      const maxTimeoutMs = 10 * 60_000;
      const sizeIn100Mb = Math.max(1, Math.ceil(file.size / (100 * 1024 * 1024)));
      const adaptiveTimeoutMs = Math.min(maxTimeoutMs, baseTimeoutMs + (sizeIn100Mb * per100MbMs));
      
      onProgress && onProgress(10);
      
      let contents: JSZip;

      try {
        // Try to load as regular zip with timeout
        contents = await loadZipFromBlob(file, 'Zip load');
        console.log('✅ Bank file loaded successfully (unencrypted)');
      } catch (error) {
        console.log('🔒 Attempting to decrypt bank file...');
        
        let decrypted = false;
        let lastError: Error | null = null;
        
        // First, try shared password (for banks with "Allow Export" disabled)
        // This works for all users (logged in or not) and doesn't require Supabase
        try {
          const headerMatch = await withTimeout(
            isZipPasswordMatch(file, SHARED_EXPORT_DISABLED_PASSWORD),
            Math.min(adaptiveTimeoutMs, 10_000),
            'Header check'
          );
          if (headerMatch) {
            const decryptedBlob = await withTimeout(
              decryptZip(file, SHARED_EXPORT_DISABLED_PASSWORD),
              adaptiveTimeoutMs,
              'Decrypt'
            );
            contents = await loadZipFromBlob(decryptedBlob, 'Zip load');
            decrypted = true;
            console.log('✅ Decrypted using shared password (export disabled encryption)');
          } else {
            throw new Error('Shared password mismatch');
          }
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          console.log('⚠️ Shared password decryption failed, trying user-specific keys...');
        }
        
        // If shared password didn't work, try user-specific keys (requires login)
        if (!decrypted) {
          // Use cached user if auth state not yet synced
          console.log('🔐 Auth check:', { user: !!user, cachedUser: !!getCachedUser(), effectiveUser: !!effectiveUser });
          
          if (!effectiveUser) {
            throw new Error('Login required to import encrypted banks. Please sign in and try again.');
          }
          
            // Try cached keys for the current user only
          const userKeyPrefix = `${effectiveUser.id}-`;
          const memoryKeys = Array.from(keyCache.entries())
            .filter(([cacheKey]) => cacheKey.startsWith(userKeyPrefix))
            .map(([, derivedKey]) => derivedKey);
          const localKeys = Object.values(getCachedBankKeysForUser(effectiveUser.id));
          const candidateKeys = Array.from(new Set([...memoryKeys, ...localKeys]));

          for (const derivedKey of candidateKeys) {
            try { 
              const headerMatch = await withTimeout(
                isZipPasswordMatch(file, derivedKey),
                Math.min(adaptiveTimeoutMs, 10_000),
                'Header check'
              );
              if (headerMatch) {
                const decryptedBlob = await withTimeout(decryptZip(file, derivedKey), adaptiveTimeoutMs, 'Decrypt');
                contents = await loadZipFromBlob(decryptedBlob, 'Zip load');
                decrypted = true;
                console.log('✅ Decrypted using cached key');
                break;
              }
            } catch (e) {
              lastError = e instanceof Error ? e : new Error(String(e));
              console.warn('Decryption attempt failed with cached key:', e);
            }
          }
          
          // Try hinted ID from filename
        if (!decrypted) {
          const hintedId = parseBankIdFromFileName(file.name);
          if (hintedId) {
              try {
                const d = await getDerivedKey(hintedId, effectiveUser.id);
                if (d) {
                  const headerMatch = await withTimeout(
                    isZipPasswordMatch(file, d),
                    Math.min(adaptiveTimeoutMs, 10_000),
                    'Header check'
                  );
                  if (headerMatch) {
                    const decryptedBlob = await withTimeout(decryptZip(file, d), adaptiveTimeoutMs, 'Decrypt');
                    contents = await loadZipFromBlob(decryptedBlob, 'Zip load');
                    decrypted = true;
                    console.log('✅ Decrypted using hinted bank ID');
                  } else {
                    throw new Error('Hinted ID password mismatch');
                  }
                }
              } catch (e) {
                lastError = e instanceof Error ? e : new Error(String(e));
                console.warn('Decryption attempt failed with hinted ID:', e);
              }
          }
        }
          
          // Try all accessible banks
        if (!decrypted) {
            try {
              const accessible = await listAccessibleBankIds(effectiveUser.id);
              console.log(`🔍 Trying ${accessible.length} accessible banks...`);
           for (const bankId of accessible) {
                try {
                  const d = await getDerivedKey(bankId, effectiveUser.id);
                  if (d) {
                    const headerMatch = await withTimeout(
                      isZipPasswordMatch(file, d),
                      Math.min(adaptiveTimeoutMs, 10_000),
                      'Header check'
                    );
                    if (headerMatch) {
                      const decryptedBlob = await withTimeout(decryptZip(file, d), adaptiveTimeoutMs, 'Decrypt');
                      contents = await loadZipFromBlob(decryptedBlob, 'Zip load');
                      decrypted = true;
                      console.log('✅ Decrypted using accessible bank ID:', bankId);
                      break;
                    }
                  }
                } catch (e) {
                  // Continue to next bank
                }
              }
            } catch (e) {
              console.error('Error checking accessible banks:', e);
            }
           }
        }
        
        if (!decrypted) {
          const errorMsg = lastError?.message || 'Unknown decryption error';
          throw new Error(`Cannot decrypt bank file. ${errorMsg}. Please ensure you have access to this bank.`);
        }
      }

      onProgress && onProgress(20);
      
      // Validate bank.json exists
      const bankJsonFile = contents.file('bank.json');
      if (!bankJsonFile) {
        throw new Error('Invalid bank file: bank.json not found. This may not be a valid bank file.');
      }
      
      // Parse bank data with error handling
      let bankData: any;
      try {
        const jsonString = await withTimeout(
          bankJsonFile.async('string'),
          adaptiveTimeoutMs,
          'Bank JSON load'
        );
        bankData = JSON.parse(jsonString);
        
      if (!bankData || typeof bankData !== 'object') {
          throw new Error('Invalid bank data structure');
        }
        
        if (!bankData.name || !Array.isArray(bankData.pads)) {
          throw new Error('Invalid bank file format: Missing required fields');
        }
        
        console.log('✅ Bank data parsed:', { name: bankData.name, padCount: bankData.pads.length });
        importBankName = bankData.name;
        importPadNames = bankData.pads.map((pad: any) => pad?.name || 'Untitled Pad');
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error('Invalid bank file: bank.json is corrupted or invalid JSON');
        }
        throw error;
      }

      if (
        bankData?.id &&
        banks.some((bank) => bank.id === bankData.id || bank.sourceBankId === bankData.id)
      ) {
      throw new Error('This bank is already imported.');
    }
      
      let metadata = await extractBankMetadata(contents);
      const metadataBankId = metadata?.bankId || parseBankIdFromFileName(file.name) || undefined;
      if (metadataBankId && !metadata?.bankId) {
        metadata = {
          ...(metadata || {}),
          bankId: metadataBankId,
        };
      }

      includePadList = !(metadata?.password === true || !!metadataBankId);
    if (
      metadataBankId &&
      banks.some(
        (bank) =>
          bank.bankMetadata?.bankId === metadataBankId ||
          bank.sourceBankId === metadataBankId ||
          bank.id === metadataBankId
      )
    ) {
      throw new Error('This bank has already been imported.');
    }
      const isAdminBank = metadata?.password === true;
      
      // LOGIC FIX: 'transferable' should come from metadata explicitly, independent of admin/encryption status
      const isTransferable = metadata?.transferable ?? true;

      let resolvedBankName = bankData.name;
      let resolvedBankColor = typeof bankData.defaultColor === 'string' ? bankData.defaultColor : '#3b82f6';
      if (metadataBankId) {
        const resolvedMetadata = await resolveAdminBankMetadata(metadataBankId);
        if (resolvedMetadata) {
          resolvedBankName = resolvedMetadata.title;
          metadata = {
            ...(metadata || {}),
            bankId: metadataBankId,
            title: resolvedMetadata.title,
            description: resolvedMetadata.description,
            color: resolvedMetadata.color || metadata?.color,
          };
          importBankName = resolvedMetadata.title;
          if (resolvedMetadata.color) {
            resolvedBankColor = resolvedMetadata.color;
          }
        } else if (metadata?.color) {
          resolvedBankColor = metadata.color;
        }
      } else if (metadata?.color) {
        resolvedBankColor = metadata.color;
      }

      // Use cached user for admin bank access checks (same effectiveUser from above)
      const userForAccess = user || getCachedUser();
      if (isAdminBank && !userForAccess) throw new Error('Login required');
      if (isAdminBank && userForAccess && metadataBankId) {
        if (!await hasBankAccess(userForAccess.id, metadataBankId)) throw new Error('Access denied');
      }

      onProgress && onProgress(30);

      const maxSortOrder = banks.length > 0 ? Math.max(...banks.map(b => b.sortOrder || 0)) : -1;
      const newBank: SamplerBank = {
        ...bankData,
        id: generateId(),
        name: resolvedBankName,
        defaultColor: resolvedBankColor,
        createdAt: bankData.createdAt ? new Date(bankData.createdAt) : new Date(),
        sortOrder: maxSortOrder + 1,
        pads: [],
        sourceBankId: metadataBankId || bankData.id,
        isAdminBank,
        transferable: isTransferable, // Set explicit flag
        exportable: metadata?.exportable ?? true,
        bankMetadata: metadata
      };
      
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      const createFastIOSBlobURL = async (blob: Blob): Promise<string> => {
        if (!isIOS) return URL.createObjectURL(blob);
        try {
          const url = URL.createObjectURL(blob);
          await new Promise<void>(resolve => {
            const audio = new Audio();
            const t = setTimeout(() => { audio.src = ''; resolve(); }, 50);
            audio.oncanplaythrough = () => { clearTimeout(t); resolve(); };
            audio.onerror = () => { clearTimeout(t); resolve(); };
            audio.src = url;
          });
          return url;
        } catch (e) {
          return URL.createObjectURL(blob);
        }
      };

      const newPads: PadData[] = [];
      const totalPads = bankData.pads.length;
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < totalPads; i += BATCH_SIZE) {
        const batchPads = bankData.pads.slice(i, i + BATCH_SIZE);
        const batchFilesToStore: BatchFileItem[] = [];
        
        const processedBatch = await Promise.all(batchPads.map(async (padData: any, padIndex: number) => {
          try {
             const newPadId = generateId();
             const audioFile = contents.file(`audio/${padData.id}.audio`);
             const imageFile = contents.file(`images/${padData.id}.image`);
             let audioUrl: string | null = null;
             let imageUrl: string | null = null;

             if (audioFile) {
               try {
                const audioBlob = await withTimeout(
                  audioFile.async('blob'),
                  adaptiveTimeoutMs,
                  'Audio load'
                );
                 
                 if (!audioBlob || audioBlob.size === 0) {
                   console.warn(`⚠️ Audio file for pad "${padData.name || padData.id}" is empty`);
                 } else {
               batchFilesToStore.push({ id: newPadId, blob: audioBlob, type: 'audio' });
               audioUrl = await createFastIOSBlobURL(audioBlob);
             }
               } catch (e) {
                 console.error(`❌ Failed to load audio for pad "${padData.name || padData.id}":`, e);
                 // Continue without audio - pad will be imported but won't play
               }
             }
             
             if (imageFile) {
               try {
                const imageBlob = await withTimeout(
                  imageFile.async('blob'),
                  adaptiveTimeoutMs,
                  'Image load'
                );
                 
                 if (!imageBlob || imageBlob.size === 0) {
                   console.warn(`⚠️ Image file for pad "${padData.name || padData.id}" is empty`);
                 } else {
               batchFilesToStore.push({ id: newPadId, blob: imageBlob, type: 'image' });
               imageUrl = await createFastIOSBlobURL(imageBlob);
                 }
               } catch (e) {
                 console.error(`❌ Failed to load image for pad "${padData.name || padData.id}":`, e);
                 // Continue without image
               }
             }

             if (audioUrl) {
               return {
                 ...padData,
                 id: newPadId,
                 audioUrl,
                 imageUrl,
                 imageData: undefined,
                shortcutKey: padData.shortcutKey || undefined,
                midiNote: typeof padData.midiNote === 'number' ? padData.midiNote : undefined,
                midiCC: typeof padData.midiCC === 'number' ? padData.midiCC : undefined,
                ignoreChannel: !!padData.ignoreChannel,
                 fadeInMs: padData.fadeInMs || 0,
                 fadeOutMs: padData.fadeOutMs || 0,
                 startTimeMs: padData.startTimeMs || 0,
                 endTimeMs: padData.endTimeMs || 0,
                 pitch: padData.pitch || 0,
                 position: padData.position ?? (newPads.length + padIndex),
               };
             } else {
               console.warn(`⚠️ Skipping pad "${padData.name || padData.id}" - no audio file found`);
             return null;
             }
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            console.error(`❌ Pad import error for pad at index ${padIndex}:`, errorMsg);
            return null;
          }
        }));

        if (batchFilesToStore.length > 0) {
          try {
            await withTimeout(
              saveBatchBlobsToDB(batchFilesToStore),
              adaptiveTimeoutMs,
              'Save batch'
            );
          } catch (e) {
            console.error('❌ Failed to save batch files to database:', e);
            throw new Error(`Failed to save files to storage: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        const validPads = processedBatch.filter(p => p !== null);
        newPads.push(...validPads);
        
        const currentProgress = 30 + ((i + BATCH_SIZE) / totalPads * 60);
        onProgress && onProgress(Math.min(95, currentProgress));
      }

      if (newPads.length === 0) {
        console.warn('⚠️ No valid pads were imported from the bank file');
        throw new Error('No valid pads found in bank file. The bank may be corrupted or empty.');
      }

      newBank.pads = newPads;
      setBanks(prev => [...prev, newBank]);
      onProgress && onProgress(100);
      console.log(`✅ Import complete: ${newPads.length} pads loaded from "${newBank.name}"`);
      logImportActivity({
        status: 'success',
        bankName: importBankName,
        bankId: newBank.sourceBankId || newBank.id,
        padNames: importPadNames,
        includePadList
      });
      return newBank;

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown import error';
      console.error('❌ Import failed:', errorMessage, e);
      logImportActivity({
        status: 'failed',
        bankName: importBankName,
        padNames: importPadNames,
        includePadList,
        errorMessage
      });
      
      // Provide more specific error messages
      if (errorMessage.includes('timeout')) {
        throw new Error('Import timed out. The file may be too large or corrupted. Please try again.');
      } else if (errorMessage.includes('decrypt') || errorMessage.includes('encryption')) {
        throw new Error('Cannot decrypt bank file. Please ensure you have access to this bank and are signed in.');
      } else if (errorMessage.includes('Invalid bank')) {
        throw new Error('Invalid bank file format. Please ensure you selected a valid .bank file.');
      } else if (errorMessage.includes('Login required')) {
        throw new Error('Please sign in to import this bank file.');
      }
      
      throw new Error(`Import failed: ${errorMessage}`);
    }
  }, [banks, user, logImportActivity]);

  // --- FIXED ADMIN EXPORT (Respects "Transferable" & Prevents Audio Bloat) ---
  const exportAdminBank = React.useCallback(async (id: string, title: string, description: string, transferable: boolean, addToDatabase: boolean, allowExport: boolean, onProgress?: (progress: number) => void) => {
      if (!user || profile?.role !== 'admin') throw new Error('Admin only');
      const bank = banks.find(b => b.id === id);
      if (!bank) throw new Error('Bank not found');
      onProgress && onProgress(5);
      
      const zip = new JSZip();
      
      const exportPads = bank.pads.map(pad => ({
        ...pad,
        audioUrl: pad.audioUrl ? `audio/${pad.id}.audio` : undefined,
        imageUrl: pad.imageUrl ? `images/${pad.id}.image` : undefined,
      }));
      
      const bankData = { ...bank, createdAt: bank.createdAt.toISOString(), pads: exportPads };
      
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      const total = bank.pads.filter(p => p.audioUrl).length + bank.pads.filter(p => p.imageUrl).length;
      let count = 0;
      
      if (audioFolder) {
        for (const pad of bank.pads) {
          if (pad.audioUrl) {
            onProgress && onProgress(5 + (count / total) * 35);
            try {
              let audioBlob = await (await fetch(pad.audioUrl)).blob();
              const originalSize = audioBlob.size;
              
              let actualDurationMs = 0;
              try {
                const arrayBuffer = await audioBlob.arrayBuffer();
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                const tempContext = new AudioContextClass();
                const audioBuffer = await tempContext.decodeAudioData(arrayBuffer.slice(0)); 
                actualDurationMs = audioBuffer.duration * 1000;
                tempContext.close();
                audioBlob = await (await fetch(pad.audioUrl)).blob();
              } catch (e) {
                console.warn('Could not get actual duration, assuming no trim out needed:', e);
                actualDurationMs = pad.endTimeMs + 1000;
              }
              
              const hasTrimIn = pad.startTimeMs > 50; 
              const hasTrimOut = pad.endTimeMs > 0 && (actualDurationMs - pad.endTimeMs) > 200; 
              const isTrimmed = hasTrimIn || hasTrimOut;
              
              if (isTrimmed && pad.endTimeMs > pad.startTimeMs) {
                console.log(`🎵 Admin Export: Pad "${pad.name}" IS trimmed. Processing...`);
                const format = detectAudioFormat(audioBlob);
                try {
                  const trimResult = await trimAudio(audioBlob, pad.startTimeMs, pad.endTimeMs, format);
                  audioBlob = trimResult.blob;
                  console.log(`✅ Trimmed "${pad.name}" - original: ${(originalSize / 1024).toFixed(1)}KB, new: ${(audioBlob.size / 1024).toFixed(1)}KB`);
                  
                  const exportPad = exportPads.find(p => p.id === pad.id);
                  if (exportPad) {
                    exportPad.startTimeMs = 0;
                    exportPad.endTimeMs = trimResult.newDurationMs; 
                  }
                } catch (trimError) {
                  console.warn(`⚠️ Trim failed for "${pad.name}", using original:`, trimError);
                }
              } else {
                 console.log(`⏩ Admin Export: Pad "${pad.name}" is NOT trimmed. Using original.`);
              }
              
              audioFolder.file(`${pad.id}.audio`, audioBlob);
            } catch (e) {
              console.error('Audio export error:', e);
            }
            count++;
          }
        }
      }
      
      if (imageFolder) {
        for (const pad of bank.pads) {
          if (pad.imageUrl) {
            onProgress && onProgress(40 + (count / total) * 10);
            try {
              const b = await (await fetch(pad.imageUrl)).blob();
              imageFolder.file(`${pad.id}.image`, b);
            } catch (e) {}
            count++;
          }
        }
      }
      
      zip.file('bank.json', JSON.stringify(bankData, null, 2));
      
      onProgress && onProgress(50);
      
      if (addToDatabase) {
        const adminBank = await createAdminBankWithDerivedKey(title, description, user.id, bank.defaultColor);
        if (!adminBank) throw new Error('DB creation failed');
        const bankId = adminBank.id;
        const derivedKey = adminBank.derived_key;
        
        // When Add to Database is enabled, export is automatically blocked (exportable: false)
        addBankMetadata(zip, { password: true, transferable, exportable: false, title, description, color: bank.defaultColor, bankId });
        
        onProgress && onProgress(60);
        
        try {
          const { supabase } = await import('@/lib/supabase');
          await supabase.from('user_bank_access').upsert({ user_id: user.id, bank_id: bankId }, { onConflict: 'user_id,bank_id' as any });
        } catch (e) {}
        
        const encrypted = await encryptZip(zip, derivedKey);
        onProgress && onProgress(80);
        
        const fileName = `${title.replace(/[^a-z0-9]/gi, '_')}.bank`;
        const saveResult = await saveBankFile(encrypted, fileName);
        if (saveResult.message) {
          console.log('✅', saveResult.message);
        }
        return saveResult.message || 'Bank exported successfully';
      } else {
        // When Add to Database is disabled, use allowExport value to control export permission
        addBankMetadata(zip, { password: !allowExport, transferable, exportable: allowExport, title, description, color: bank.defaultColor });
        
        onProgress && onProgress(60);
        
        if (!allowExport) {
          // Encrypt with shared password when Allow Export is disabled
          console.log('🔒 Encrypting bank with shared password (export disabled)');
          const encrypted = await encryptZip(zip, SHARED_EXPORT_DISABLED_PASSWORD);
          onProgress && onProgress(90);
          
          const fileName = `${title.replace(/[^a-z0-9]/gi, '_')}.bank`;
          const saveResult = await saveBankFile(encrypted, fileName);
          if (saveResult.message) {
            console.log('✅', saveResult.message);
          }
          onProgress && onProgress(100);
          return saveResult.message || 'Bank exported successfully';
        } else {
          // Unencrypted when Allow Export is enabled
        console.log('📦 Creating shareable admin bank (unencrypted, no database entry)');
        
        const zipBlob = await zip.generateAsync({ 
          type: 'blob', 
          compression: 'DEFLATE', 
          compressionOptions: { level: 9 } 
        }, (m) => onProgress && onProgress(60 + (m.percent * 0.3)));
        
        onProgress && onProgress(90);
        
          const fileName = `${title.replace(/[^a-z0-9]/gi, '_')}.bank`;
          const saveResult = await saveBankFile(zipBlob, fileName);
          if (saveResult.message) {
            console.log('✅', saveResult.message);
      }
      onProgress && onProgress(100);
          return saveResult.message || 'Bank exported successfully';
        }
      }
  }, [banks, user, profile]);

  const canTransferFromBank = React.useCallback((bankId: string): boolean => {
    const bank = banks.find(b => b.id === bankId);
    if (!bank) return false;
    // LOGIC FIX: Check transferable property directly, not just isAdminBank
    if (typeof bank.transferable === 'boolean') return bank.transferable;
    if (bank.bankMetadata && typeof bank.bankMetadata.transferable === 'boolean') return bank.bankMetadata.transferable;
    return true; // Default allow if flag is missing
  }, [banks]);

  // Detect environment for asset path resolution
  const getDefaultBankPath = React.useCallback(() => {
    const isElectron = window.navigator.userAgent.includes('Electron');
    const isAndroid = /Android/.test(navigator.userAgent);
    
    if (isElectron) {
      // Electron uses file:// protocol, needs relative path
      return './assets/DEFAULT_BANK.bank';
    } else if (isAndroid) {
      // Android APK - try absolute first, fallback to relative
      return '/assets/DEFAULT_BANK.bank';
    } else {
      // Web - use absolute path
      return '/assets/DEFAULT_BANK.bank';
    }
  }, []);
  // Track previous user ID to detect login events
  const prevUserIdRef = React.useRef<string | null>(null);

  // Auto-load default bank ONLY when user logs in (not on every render)
  React.useEffect(() => {
    const currentUser = user || getCachedUser();
    const currentUserId = currentUser?.id || null;

    if (!currentUserId) {
      prevUserIdRef.current = null;
      attemptedDefaultLoadUserRef.current = null;
      return;
    }

    const justLoggedIn = currentUserId && prevUserIdRef.current !== currentUserId;
    if (!justLoggedIn) {
      prevUserIdRef.current = currentUserId;
      return;
    }

    prevUserIdRef.current = currentUserId;
    if (attemptedDefaultLoadUserRef.current === currentUserId) return;
    attemptedDefaultLoadUserRef.current = currentUserId;

    const userDefaultBankKey = `${DEFAULT_BANK_LOADED_KEY}_${currentUserId}`;
    const alreadyLoaded = getLocalStorageItemSafe(userDefaultBankKey);

    const lockKey = `${DEFAULT_BANK_LOADING_LOCK_KEY}_${currentUserId}`;
    const existingLock = getLocalStorageItemSafe(lockKey);
    const lockTs = Number(existingLock || 0);
    if (existingLock && Number.isFinite(lockTs) && Date.now() - lockTs < 120000) {
      console.log('Default bank load is already in progress for this user, skipping.');
      return;
    }

    const loadDefaultBank = async () => {
      setLocalStorageItemSafe(lockKey, String(Date.now()));
      try {
        const hasNonEmptyDefault = banks.some(
          (bank) => bank.name === 'Default Bank' && Array.isArray(bank.pads) && bank.pads.length > 0
        );
        if (hasNonEmptyDefault) {
          setLocalStorageItemSafe(userDefaultBankKey, 'true');
          return;
        }

        // Find and delete empty "Default Bank" if it exists
        const emptyDefaultBank = banks.find(
          (b) => b.name === 'Default Bank' && (!b.pads || b.pads.length === 0)
        );
        if (emptyDefaultBank) {
          setBanks((prev) => prev.filter((b) => b.id !== emptyDefaultBank.id));
          if (currentBankId === emptyDefaultBank.id) {
            setCurrentBankIdState(null);
          }
        }

        const basePath = getDefaultBankPath();

        // Try primary path
        let response = await fetch(basePath);

        // If failed and Android, try relative path as fallback
        if (!response.ok && /Android/.test(navigator.userAgent) && basePath.startsWith('/')) {
          response = await fetch('./assets/DEFAULT_BANK.bank');
        }

        // If still failed and Electron, try absolute path as fallback
        if (!response.ok && window.navigator.userAgent.includes('Electron') && basePath.startsWith('./')) {
          response = await fetch('/assets/DEFAULT_BANK.bank');
        }

        if (!response.ok) {
          throw new Error(`Default bank file not found: ${response.status} ${response.statusText}`);
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error('Default bank file is empty');
        }

        const file = new File([blob], 'DEFAULT_BANK.bank', { type: 'application/zip' });

        // Import the bank
        const importedBank = await importBank(file);
        if (importedBank) {
          // Rename to "Default Bank" and set as current
          updateBank(importedBank.id, { name: 'Default Bank' });
          setCurrentBankIdState(importedBank.id);
          setLocalStorageItemSafe(userDefaultBankKey, 'true');
        } else {
          throw new Error('Import returned null');
        }
      } catch (error) {
        console.warn('Failed to load default bank:', error);
      } finally {
        if (typeof window !== 'undefined') {
          try {
            localStorage.removeItem(lockKey);
          } catch {}
        }
      }
    };

    if (!alreadyLoaded) {
      loadDefaultBank();
    }
  }, [user?.id, importBank, updateBank, getDefaultBankPath, banks, currentBankId]);


  return {
    banks, primaryBankId, secondaryBankId, currentBankId, primaryBank, secondaryBank, currentBank, isDualMode,
    addPad, addPads, updatePad, removePad, createBank, setPrimaryBank, setSecondaryBank, setCurrentBank, updateBank, deleteBank, importBank, exportBank, reorderPads, moveBankUp, moveBankDown, transferPad, exportAdminBank, canTransferFromBank,
  };
}
