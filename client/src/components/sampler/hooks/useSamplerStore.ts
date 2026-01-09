import * as React from 'react';
import JSZip from 'jszip';
import { PadData, SamplerBank, BankMetadata } from '../types/sampler';
import { 
  derivePassword, 
  encryptZip, 
  decryptZip, 
  getDerivedKey, 
  createAdminBankWithDerivedKey, 
  addBankMetadata, 
  extractBankMetadata,
  clearKeyCache,
  hasBankAccess,
  keyCache,
  parseBankIdFromFileName,
  listAccessibleBankIds 
} from '@/lib/bank-utils';
import { useAuth } from '@/hooks/useAuth';

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
  exportBank: (id: string, onProgress?: (progress: number) => void) => Promise<void>;
  reorderPads: (bankId: string, fromIndex: number, toIndex: number) => void;
  moveBankUp: (id: string) => void;
  moveBankDown: (id: string) => void;
  transferPad: (padId: string, sourceBankId: string, targetBankId: string) => void;
  exportAdminBank: (id: string, title: string, description: string, transferable: boolean, onProgress?: (progress: number) => void) => Promise<void>;
  canTransferFromBank: (bankId: string) => boolean;
}

const STORAGE_KEY = 'vdjv-sampler-banks';
const STATE_STORAGE_KEY = 'vdjv-sampler-state';

// File System Access API support check
const supportsFileSystemAccess = () => {
  return 'showOpenFilePicker' in window && 'FileSystemFileHandle' in window;
};

// IndexedDB setup for file handles and blob storage
const openFileDB = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('vdjv-file-storage', 4);
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

// Quota tracking helpers (same as before)
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

// ... (Keep existing helpers: saveFileHandle, getFileHandle, deleteFileHandle, getBlobFromDB, deleteBlobFromDB, saveBlobToDB) ...
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

// ... (base64 and restore helpers remain same) ...
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
  const { user, profile } = useAuth();
  const [banks, setBanks] = React.useState<SamplerBank[]>([]);
  const [primaryBankId, setPrimaryBankIdState] = React.useState<string | null>(null);
  const [secondaryBankId, setSecondaryBankIdState] = React.useState<string | null>(null);
  const [currentBankId, setCurrentBankIdState] = React.useState<string | null>(null);

  const primaryBank = React.useMemo(() => banks.find(b => b.id === primaryBankId) || null, [banks, primaryBankId]);
  const secondaryBank = React.useMemo(() => banks.find(b => b.id === secondaryBankId) || null, [banks, secondaryBankId]);
  const currentBank = React.useMemo(() => banks.find(b => b.id === currentBankId) || null, [banks, currentBankId]);
  const isDualMode = React.useMemo(() => primaryBankId !== null, [primaryBankId]);

  // ... (Keep existing State Effects: localStorage save/restore) ...
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({ primaryBankId, secondaryBankId, currentBankId }));
    }
  }, [primaryBankId, secondaryBankId, currentBankId]);

  const restoreAllFiles = React.useCallback(async () => {
    // ... (Keep existing restore logic exactly as is) ...
    if (typeof window === 'undefined') return;
    const savedData = localStorage.getItem(STORAGE_KEY);
    const savedState = localStorage.getItem(STATE_STORAGE_KEY);

    if (!savedData) {
      const defaultBank: SamplerBank = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 };
      setBanks([defaultBank]); setCurrentBankIdState(defaultBank.id);
      return;
    }
    try {
      const { banks: savedBanks } = JSON.parse(savedData);
      let restoredState = { primaryBankId: null, secondaryBankId: null, currentBankId: null };
      if (savedState) try { restoredState = JSON.parse(savedState); } catch (e) {}

      const restoredBanks = await Promise.all(savedBanks.map(async (bank: any, index: number) => {
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
    // ... (Keep existing localStorage save logic) ...
    if (typeof window !== 'undefined' && banks.length > 0) {
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
                id: pad.id, name: pad.name, color: pad.color, triggerMode: pad.triggerMode, playbackMode: pad.playbackMode, volume: pad.volume, fadeInMs: pad.fadeInMs, fadeOutMs: pad.fadeOutMs, startTimeMs: pad.startTimeMs, endTimeMs: pad.endTimeMs, pitch: pad.pitch, position: pad.position
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

  // ... (Keep simple addPad, addPads, updatePad, etc) ...
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
        id: padId, name: file.name.replace(/\.[^/.]+$/, ''), audioUrl, color: targetBank.defaultColor, triggerMode: 'toggle', playbackMode: 'once', volume: 1, fadeInMs: 0, fadeOutMs: 0, startTimeMs: 0, endTimeMs: 0, pitch: 0, position: maxPosition + 1,
      };
      const audio = new Audio(audioUrl);
      audio.addEventListener('loadedmetadata', () => {
        newPad.endTimeMs = audio.duration * 1000;
        setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, newPad] } : b));
      });
      setTimeout(() => { if (newPad.endTimeMs === 0) { newPad.endTimeMs = 30000; setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, newPad] } : b)); } }, 1000);
    } catch (e) { throw e; }
  }, [banks, getTargetBankId]);

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

      // Prepare all files
      for (const file of validFiles) {
        if (file.size > 50 * 1024 * 1024) continue;
        const padId = generateId();
        const audioUrl = URL.createObjectURL(file);
        
        batchItems.push({ id: padId, blob: file, type: 'audio' });
        
        maxPosition++;
        const newPad: PadData = {
          id: padId, name: file.name.replace(/\.[^/.]+$/, ''), audioUrl, color: targetBank.defaultColor, triggerMode: 'toggle', playbackMode: 'once', volume: 1, fadeInMs: 0, fadeOutMs: 0, startTimeMs: 0, endTimeMs: 0, pitch: 0, position: maxPosition,
        };
        newPads.push(newPad);
        
        // Metadata loading
        const audio = new Audio(audioUrl);
        audio.addEventListener('loadedmetadata', () => { newPad.endTimeMs = audio.duration * 1000; setBanks(p => [...p]); });
      }

      // Bulk Save!
      if (batchItems.length > 0) {
        await saveBatchBlobsToDB(batchItems);
        setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, ...newPads] } : b));
      }
    } catch (e) { throw e; }
  }, [banks, getTargetBankId]);

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

  // ... (Keep reorderPads, createBank, moveBankUp/Down, transferPad, etc) ...
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

  const exportBank = React.useCallback(async (id: string, onProgress?: (progress: number) => void) => {
    // ... (Keep existing export logic - it's already reasonably fast for writes) ...
    const bank = banks.find(b => b.id === id);
    if (!bank) throw new Error('Bank not found');
    try {
      const zip = new JSZip();
      const bankData = { ...bank, createdAt: bank.createdAt.toISOString(), pads: bank.pads.map(pad => ({ ...pad, audioUrl: pad.audioUrl ? `audio/${pad.id}.audio` : undefined, imageUrl: pad.imageUrl ? `images/${pad.id}.image` : undefined, })) };
      zip.file('bank.json', JSON.stringify(bankData, null, 2));
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      const totalFiles = bank.pads.filter(p => p.audioUrl).length + bank.pads.filter(p => p.imageUrl).length;
      let processedFiles = 0;
      if (audioFolder) {
        for (const pad of bank.pads) {
          if (pad.audioUrl) {
            onProgress && onProgress((processedFiles / totalFiles) * 50);
            try { const b = await (await fetch(pad.audioUrl)).blob(); audioFolder.file(`${pad.id}.audio`, b); } catch (e) {}
            processedFiles++;
          }
        }
      }
      if (imageFolder) {
        for (const pad of bank.pads) {
          if (pad.imageUrl) {
            onProgress && onProgress(50 + (processedFiles / totalFiles) * 30);
            try { const b = await (await fetch(pad.imageUrl)).blob(); imageFolder.file(`${pad.id}.image`, b); } catch (e) {}
            processedFiles++;
          }
        }
      }
      onProgress && onProgress(80);
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } }, (m) => onProgress && onProgress(80 + (m.percent * 0.2)));
      onProgress && onProgress(100);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a'); a.href = url; a.download = `${bank.name.replace(/[^a-z0-9]/gi, '_')}.bank`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { throw e; }
  }, [banks]);

  // --- OPTIMIZED IMPORT BANK ---
  const importBank = React.useCallback(async (file: File, onProgress?: (progress: number) => void) => {
    try {
      console.log('🚀 Starting optimized import...');
      onProgress && onProgress(10);
      
      const zip = new JSZip();
      let contents: JSZip;

      // ... (Decryption Logic remains the same) ...
      try {
        contents = await zip.loadAsync(file);
      } catch (error) {
        if (!user) throw new Error('Login required to import encrypted banks');
        let decrypted = false;
        // ... (Try cached keys) ...
        for (const [cacheKey, derivedKey] of keyCache.entries()) {
          try { contents = await zip.loadAsync(await decryptZip(file, derivedKey)); decrypted = true; break; } catch (e) {}
        }
        // ... (Try filename hint) ...
        if (!decrypted) {
          const hintedId = parseBankIdFromFileName(file.name);
          if (hintedId) {
             const d = await getDerivedKey(hintedId, user.id);
             if (d) try { contents = await zip.loadAsync(await decryptZip(file, d)); decrypted = true; } catch (e) {}
          }
        }
        // ... (Try accessible banks) ...
        if (!decrypted) {
           const accessible = await listAccessibleBankIds(user.id);
           for (const bankId of accessible) {
             const d = await getDerivedKey(bankId, user.id);
             if (d) try { contents = await zip.loadAsync(await decryptZip(file, d)); decrypted = true; break; } catch (e) {}
           }
        }
        if (!decrypted) throw new Error('Encryption error or access denied');
      }

      onProgress && onProgress(20);
      
      // Parse Metadata
      const bankJsonFile = contents.file('bank.json');
      if (!bankJsonFile) throw new Error('Invalid bank file');
      const bankData = JSON.parse(await bankJsonFile.async('string'));
      
      const metadata = await extractBankMetadata(contents);
      const isAdminBank = metadata?.password === true;
      if (isAdminBank && !user) throw new Error('Login required');
      if (isAdminBank && user && metadata?.bankId) {
        if (!await hasBankAccess(user.id, metadata.bankId)) throw new Error('Access denied');
      }

      onProgress && onProgress(30);

      const maxSortOrder = banks.length > 0 ? Math.max(...banks.map(b => b.sortOrder || 0)) : -1;
      const newBank: SamplerBank = {
        ...bankData,
        id: generateId(),
        name: `${bankData.name} (new)`,
        createdAt: bankData.createdAt ? new Date(bankData.createdAt) : new Date(),
        sortOrder: maxSortOrder + 1,
        pads: [],
        isAdminBank,
        transferable: metadata?.transferable ?? true,
        exportable: metadata?.exportable ?? true,
        bankMetadata: metadata
      };

      // --- OPTIMIZED BATCH PROCESSING START ---
      
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      
      // Fast iOS safe URL creator (50ms timeout vs 2000ms)
      const createFastIOSBlobURL = async (blob: Blob): Promise<string> => {
        if (!isIOS) return URL.createObjectURL(blob);
        try {
          const url = URL.createObjectURL(blob);
          await new Promise<void>(resolve => {
            const audio = new Audio();
            // Don't wait forever - if it takes >50ms, just assume it's fine and move on
            // This prevents the "hanging" feeling on import
            const t = setTimeout(() => { audio.src = ''; resolve(); }, 50);
            audio.oncanplaythrough = () => { clearTimeout(t); resolve(); };
            audio.onerror = () => { clearTimeout(t); resolve(); };
            audio.src = url;
          });
          return url;
        } catch (e) {
          return URL.createObjectURL(blob); // Fallback
        }
      };

      const newPads: PadData[] = [];
      const totalPads = bankData.pads.length;
      
      // Process in batches of 10 to balance memory vs speed
      const BATCH_SIZE = 10;
      
      for (let i = 0; i < totalPads; i += BATCH_SIZE) {
        const batchPads = bankData.pads.slice(i, i + BATCH_SIZE);
        const batchFilesToStore: BatchFileItem[] = [];
        
        // Process batch in parallel
        const processedBatch = await Promise.all(batchPads.map(async (padData: any) => {
          try {
             const newPadId = generateId();
             const audioFile = contents.file(`audio/${padData.id}.audio`);
             const imageFile = contents.file(`images/${padData.id}.image`);
             
             let audioUrl: string | null = null;
             let imageUrl: string | null = null;

             // Extract Audio
             if (audioFile) {
               const audioBlob = await audioFile.async('blob');
               batchFilesToStore.push({ id: newPadId, blob: audioBlob, type: 'audio' });
               audioUrl = await createFastIOSBlobURL(audioBlob);
             }

             // Extract Image
             if (imageFile) {
               const imageBlob = await imageFile.async('blob');
               batchFilesToStore.push({ id: newPadId, blob: imageBlob, type: 'image' });
               imageUrl = await createFastIOSBlobURL(imageBlob);
             }

             if (audioUrl) {
               return {
                 ...padData,
                 id: newPadId,
                 audioUrl,
                 imageUrl,
                 imageData: undefined, // Clear legacy data
                 fadeInMs: padData.fadeInMs || 0,
                 fadeOutMs: padData.fadeOutMs || 0,
                 startTimeMs: padData.startTimeMs || 0,
                 endTimeMs: padData.endTimeMs || 0,
                 pitch: padData.pitch || 0,
                 position: padData.position || (newPads.length + batchPads.indexOf(padData)),
               };
             }
             return null;
          } catch (e) {
            console.error('Pad import error:', e);
            return null;
          }
        }));

        // Bulk Save to DB (One transaction for the whole batch)
        if (batchFilesToStore.length > 0) {
          await saveBatchBlobsToDB(batchFilesToStore);
        }

        // Add successful pads
        const validPads = processedBatch.filter(p => p !== null);
        newPads.push(...validPads);
        
        // Update Progress
        const currentProgress = 30 + ((i + BATCH_SIZE) / totalPads * 60);
        onProgress && onProgress(Math.min(95, currentProgress));
      }

      newBank.pads = newPads;
      setBanks(prev => [...prev, newBank]);
      onProgress && onProgress(100);
      console.log(`✅ Import complete: ${newPads.length} pads loaded`);
      return newBank;

    } catch (e) {
      console.error('Import failed:', e);
      throw e;
    }
  }, [banks, user]);

  // ... (Keep existing exportAdminBank, canTransferFromBank) ...
  const exportAdminBank = React.useCallback(async (id: string, title: string, description: string, transferable: boolean, onProgress?: (progress: number) => void) => {
      // ... (Same logic as before) ...
      if (!user || profile?.role !== 'admin') throw new Error('Admin only');
      const bank = banks.find(b => b.id === id);
      if (!bank) throw new Error('Bank not found');
      onProgress && onProgress(10);
      const zip = new JSZip();
      const bankData = { ...bank, createdAt: bank.createdAt.toISOString(), pads: bank.pads.map(pad => ({ ...pad, audioUrl: pad.audioUrl ? `audio/${pad.id}.audio` : undefined, imageUrl: pad.imageUrl ? `images/${pad.id}.image` : undefined })) };
      zip.file('bank.json', JSON.stringify(bankData, null, 2));
      addBankMetadata(zip, { password: true, transferable, exportable: false, title, description });
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      const total = bank.pads.filter(p => p.audioUrl).length + bank.pads.filter(p => p.imageUrl).length;
      let count = 0;
      if (audioFolder) { for (const p of bank.pads) { if (p.audioUrl) { onProgress && onProgress((count/total)*30); try { const b = await (await fetch(p.audioUrl)).blob(); audioFolder.file(`${p.id}.audio`, b); } catch(e){} count++; } } }
      if (imageFolder) { for (const p of bank.pads) { if (p.imageUrl) { onProgress && onProgress(30 + (count/total)*20); try { const b = await (await fetch(p.imageUrl)).blob(); imageFolder.file(`${p.id}.image`, b); } catch(e){} count++; } } }
      onProgress && onProgress(50);
      const adminBank = await createAdminBankWithDerivedKey(title, description, user.id);
      if (!adminBank) throw new Error('DB creation failed');
      onProgress && onProgress(60);
      const encrypted = await encryptZip(zip, adminBank.derived_key);
      onProgress && onProgress(80);
      const url = URL.createObjectURL(encrypted);
      const a = document.createElement('a'); a.href = url; a.download = `${title.replace(/[^a-z0-9]/gi, '_')}.bank`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      onProgress && onProgress(100);
      try {
        const { supabase } = await import('@/lib/supabase');
        await supabase.from('user_bank_access').upsert({ user_id: user.id, bank_id: adminBank.id }, { onConflict: 'user_id,bank_id' as any });
      } catch (e) {}
  }, [banks, user, profile]);

  const canTransferFromBank = React.useCallback((bankId: string): boolean => {
    const bank = banks.find(b => b.id === bankId);
    if (!bank) return false;
    if (bank.isAdminBank && bank.bankMetadata) return bank.bankMetadata.transferable;
    return true;
  }, [banks]);

  return {
    banks, primaryBankId, secondaryBankId, currentBankId, primaryBank, secondaryBank, currentBank, isDualMode,
    addPad, addPads, updatePad, removePad, createBank, setPrimaryBank, setSecondaryBank, setCurrentBank, updateBank, deleteBank, importBank, exportBank, reorderPads, moveBankUp, moveBankDown, transferPad, exportAdminBank, canTransferFromBank,
  };
}