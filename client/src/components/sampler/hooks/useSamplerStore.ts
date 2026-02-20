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

const isNativeCapacitorPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as any).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
};

const EXPORT_FOLDER_NAME = 'VDJV-Export';
const ANDROID_DOWNLOAD_ROOT = '/storage/emulated/0/Download';
const NATIVE_MEDIA_ROOT = `${EXPORT_FOLDER_NAME}/_media`;
const EXPORT_LOGS_FOLDER = `${EXPORT_FOLDER_NAME}/logs`;
// Keep bridge payloads small to avoid Android WebView/Capacitor OOM while JSON-encoding plugin calls.
const CAPACITOR_EXPORT_SINGLE_WRITE_BYTES = 512 * 1024;
const CAPACITOR_EXPORT_CHUNK_BYTES = 256 * 1024;
const BACKUP_VERSION = 2;
const BACKUP_EXT = '.vdjvbackup';
const BACKUP_PART_EXT = '.vdjvpart';
const BACKUP_MANIFEST_SCHEMA = 'vdjv-backup-manifest-v1';
const BACKUP_MANIFEST_VERSION = 1;
const MIN_FREE_STORAGE_BYTES = 200 * 1024 * 1024;
const MAX_UNKNOWN_STORAGE_OPERATION_BYTES = 450 * 1024 * 1024;
const MAX_UNKNOWN_STORAGE_IMPORT_BYTES = 3 * 1024 * 1024 * 1024;
const MAX_NATIVE_BANK_EXPORT_BYTES = 700 * 1024 * 1024;
const MAX_NATIVE_APP_BACKUP_BYTES = 1700 * 1024 * 1024;
const BACKUP_PART_SIZE_MOBILE_BYTES = 64 * 1024 * 1024;
const BACKUP_PART_SIZE_DESKTOP_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_PART_COUNT = 200;
const MAX_NATIVE_STARTUP_RESTORE_PADS = 320;
const MAX_CAPACITOR_NATIVE_AUDIO_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_CAPACITOR_NATIVE_IMAGE_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_CAPACITOR_BRIDGE_READ_BYTES = 6 * 1024 * 1024;
const NATIVE_IMPORT_CONCURRENCY = 1;
const WEB_IMPORT_CONCURRENCY = 4;
const IMPORT_BATCH_FLUSH_COUNT = 12;
const IMPORT_BATCH_FLUSH_BYTES = 48 * 1024 * 1024;
const IMPORT_FILE_ACCESS_DENIED_MESSAGE =
  'Cannot read the selected file. Android denied storage access. Please import via the in-app picker and allow file access when prompted.';
const BACKUP_FILE_ACCESS_DENIED_MESSAGE =
  'Cannot read the selected backup file. Please pick it again from the in-app file picker and allow file access.';

type MediaBackend = 'native' | 'idb';
type OperationName = 'bank_export' | 'admin_bank_export' | 'app_backup_export' | 'app_backup_restore';
const nativeWriteFallbackLogged = new Set<'audio' | 'image'>();

interface BackupPartManifestEntry {
  index: number;
  fileName: string;
  size: number;
  offset: number;
}

interface BackupArchiveManifest {
  schema: string;
  manifestVersion: number;
  backupVersion: number;
  backupId: string;
  exportedAt: string;
  userId: string;
  encryptedSize: number;
  partSize: number;
  parts: BackupPartManifestEntry[];
}

const fnv1aHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildBankDuplicateSignature = (name: string, padNames: string[]): string => {
  const normalizedName = name.trim().toLowerCase();
  const normalizedPadNames = padNames
    .map((padName) => padName.trim().toLowerCase())
    .join('|');
  return `sig:${fnv1aHash(`${normalizedName}::${padNames.length}::${normalizedPadNames}`)}:${padNames.length}`;
};

const getBankDuplicateSignature = (
  bankLike: { name?: string; pads?: Array<{ name?: string }> } | null | undefined
): string | null => {
  const name = typeof bankLike?.name === 'string' ? bankLike.name : '';
  const pads = Array.isArray(bankLike?.pads) ? bankLike.pads : [];
  if (!name || !pads.length) return null;
  const padNames = pads.map((pad) => (typeof pad?.name === 'string' ? pad.name : ''));
  return buildBankDuplicateSignature(name, padNames);
};

interface OperationStage {
  stage: string;
  at: string;
  details?: Record<string, unknown>;
}

interface OperationDiagnostics {
  operationId: string;
  operation: OperationName;
  startedAt: string;
  endedAt?: string;
  platform: string;
  isCapacitorNative: boolean;
  isElectron: boolean;
  userId?: string | null;
  stages: OperationStage[];
  metrics: Record<string, number>;
  error?: {
    message: string;
    stack?: string;
  };
}

const normalizeFolderPath = (path: string): string => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const getRuntimePlatformLabel = (): string => {
  if (typeof window === 'undefined') return 'unknown';
  if (isNativeCapacitorPlatform()) return isNativeAndroid() ? 'capacitor-android' : 'capacitor-ios';
  if (window.navigator.userAgent.includes('Electron')) return 'electron';
  return 'web';
};

const isMobileBrowserRuntime = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
};

const getBackupPartSizeBytes = (): number => {
  if (isNativeCapacitorPlatform()) {
    return BACKUP_PART_SIZE_MOBILE_BYTES;
  }
  // Mobile web has poor multi-file selection/download UX; prefer single backup file there.
  if (isMobileBrowserRuntime()) {
    return 1024 * 1024 * 1024;
  }
  return BACKUP_PART_SIZE_DESKTOP_BYTES;
};

const buildBackupBaseName = (backupId: string): string => `vdjv-full-backup-${backupId}`;

const buildBackupManifestName = (backupId: string): string => `${buildBackupBaseName(backupId)}${BACKUP_EXT}`;

const splitBlobIntoParts = (
  blob: Blob,
  partSize: number,
  backupId: string
): Array<{ fileName: string; blob: Blob; index: number; offset: number }> => {
  const safePartSize = Math.max(1, partSize);
  const totalParts = Math.max(1, Math.ceil(blob.size / safePartSize));
  if (totalParts > MAX_BACKUP_PART_COUNT) {
    throw new Error(
      `Backup requires ${totalParts} parts, exceeding supported limit (${MAX_BACKUP_PART_COUNT}). Reduce library size and try again.`
    );
  }
  const padWidth = Math.max(3, String(totalParts).length);
  const parts: Array<{ fileName: string; blob: Blob; index: number; offset: number }> = [];

  for (let index = 0; index < totalParts; index += 1) {
    const offset = index * safePartSize;
    const partBlob = blob.slice(offset, Math.min(blob.size, offset + safePartSize));
    const fileName = `${buildBackupBaseName(backupId)}.part-${String(index + 1).padStart(padWidth, '0')}${BACKUP_PART_EXT}`;
    parts.push({ fileName, blob: partBlob, index, offset });
  }

  return parts;
};

const isBackupManifestLike = (value: unknown): value is BackupArchiveManifest => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackupArchiveManifest>;
  if (candidate.schema !== BACKUP_MANIFEST_SCHEMA) return false;
  if (!Array.isArray(candidate.parts)) return false;
  if (typeof candidate.userId !== 'string' || !candidate.userId.trim()) return false;
  return candidate.parts.every(
    (part) =>
      part &&
      typeof part.index === 'number' &&
      Number.isFinite(part.index) &&
      typeof part.fileName === 'string' &&
      part.fileName.trim().length > 0 &&
      typeof part.size === 'number' &&
      part.size >= 0
  );
};

const tryParseBackupManifestFile = async (file: File): Promise<BackupArchiveManifest | null> => {
  if (file.size > 8 * 1024 * 1024) return null;

  try {
    const preview = await file.slice(0, 128).text();
    if (!preview.trimStart().startsWith('{')) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(await file.text()) as unknown;
    if (!isBackupManifestLike(payload)) return null;
    return payload;
  } catch {
    return null;
  }
};

const readNativeExportBackupFileByName = async (fileName: string): Promise<File | null> => {
  if (!isNativeCapacitorPlatform()) return null;

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');

    const readAsFile = async (
      read: () => Promise<{ data: string | Blob }>,
      label: string
    ): Promise<File | null> => {
      try {
        const result = await read();
        if (result.data instanceof Blob) {
          return new File([result.data], fileName, { type: 'application/octet-stream' });
        }
        const base64 = normalizeBase64Data(String(result.data || ''));
        if (!base64) return null;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        return new File([bytes], fileName, { type: 'application/octet-stream' });
      } catch (error) {
        if ((label === 'android-download' || label === 'documents') && error) {
          return null;
        }
        return null;
      }
    };

    if (isNativeAndroid()) {
      const androidAbsolutePath = `${ANDROID_DOWNLOAD_ROOT}/${EXPORT_FOLDER_NAME}/${fileName}`;
      const fromDownload = await readAsFile(
        () => Filesystem.readFile({ path: androidAbsolutePath }),
        'android-download'
      );
      if (fromDownload) return fromDownload;
    }

    const fromDocuments = await readAsFile(
      () => Filesystem.readFile({ path: `${EXPORT_FOLDER_NAME}/${fileName}`, directory: Directory.Documents }),
      'documents'
    );
    if (fromDocuments) return fromDocuments;
  } catch {
    return null;
  }

  return null;
};

const resolveManifestBackupBlob = async (
  manifest: BackupArchiveManifest,
  manifestFile: File,
  companionFiles: File[],
  diagnostics?: OperationDiagnostics
): Promise<{ encryptedBlob: Blob; resolvedParts: number; missingParts: string[] }> => {
  const fileByLowerName = new Map<string, File>();
  const allSelected = [manifestFile, ...companionFiles];
  allSelected.forEach((selectedFile) => {
    fileByLowerName.set(selectedFile.name.toLowerCase(), selectedFile);
  });

  const missing: string[] = [];
  const resolvedParts: Array<{ entry: BackupPartManifestEntry; file: File }> = [];

  const sortedParts = [...manifest.parts].sort((a, b) => a.index - b.index);
  for (const entry of sortedParts) {
    let partFile = fileByLowerName.get(entry.fileName.toLowerCase()) || null;
    if (!partFile) {
      partFile = await readNativeExportBackupFileByName(entry.fileName);
      if (partFile) {
        fileByLowerName.set(entry.fileName.toLowerCase(), partFile);
      }
    }

    if (!partFile) {
      missing.push(entry.fileName);
      continue;
    }

    if (typeof entry.size === 'number' && entry.size >= 0 && partFile.size !== entry.size) {
      throw new Error(
        `Backup part "${entry.fileName}" size mismatch. Expected ${entry.size} bytes, got ${partFile.size} bytes.`
      );
    }

    resolvedParts.push({ entry, file: partFile });
  }

  if (missing.length > 0) {
    return { encryptedBlob: new Blob(), resolvedParts: resolvedParts.length, missingParts: missing };
  }

  if (diagnostics) {
    addOperationStage(diagnostics, 'resolve-backup-parts', {
      manifest: manifestFile.name,
      expectedParts: sortedParts.length,
      resolvedParts: resolvedParts.length,
    });
  }

  const orderedFiles = resolvedParts
    .sort((a, b) => a.entry.index - b.entry.index)
    .map((part) => part.file);

  return {
    encryptedBlob: new Blob(orderedFiles, { type: 'application/octet-stream' }),
    resolvedParts: orderedFiles.length,
    missingParts: [],
  };
};

const createOperationDiagnostics = (operation: OperationName, userId?: string | null): OperationDiagnostics => ({
  operationId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  operation,
  startedAt: new Date().toISOString(),
  platform: getRuntimePlatformLabel(),
  isCapacitorNative: isNativeCapacitorPlatform(),
  isElectron: typeof window !== 'undefined' && window.navigator.userAgent.includes('Electron'),
  userId: userId || null,
  stages: [],
  metrics: {}
});

const addOperationStage = (
  diagnostics: OperationDiagnostics,
  stage: string,
  details?: Record<string, unknown>
) => {
  diagnostics.stages.push({ stage, at: new Date().toISOString(), details });
};

const sanitizeOperationError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack ? error.stack.slice(0, 4000) : undefined
    };
  }
  return { message: String(error) };
};

const extractErrorText = (error: unknown): string => {
  if (error instanceof Error) return `${error.name} ${error.message}`.toLowerCase();
  return String(error || '').toLowerCase();
};

const isFileAccessDeniedError = (error: unknown): boolean => {
  const text = extractErrorText(error);
  return (
    text.includes('permission to access file') ||
    text.includes('notreadableerror') ||
    text.includes('requested file could not be read') ||
    text.includes('securityerror') ||
    text.includes('permission denied') ||
    text.includes('not allowed to read local resource') ||
    text.includes('operation not permitted')
  );
};

const ensureExportPermission = async (): Promise<void> => {
  if (!isNativeAndroid()) return;
  const { Filesystem } = await import('@capacitor/filesystem');
  const permissionStatus = await Filesystem.checkPermissions();
  if (permissionStatus.publicStorage === 'granted') return;
  const requested = await Filesystem.requestPermissions();
  if (requested.publicStorage !== 'granted') {
    throw new Error('Storage permission was denied. Please allow storage access and try again.');
  }
};

const saveExportFile = async (
  blob: Blob,
  fileName: string,
  relativeFolder: string = EXPORT_FOLDER_NAME
): Promise<{ success: boolean; message?: string; savedPath?: string }> => {
  const normalizedFolder = normalizeFolderPath(relativeFolder);
  if (isNativeCapacitorPlatform()) {
    try {
      await ensureExportPermission();
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Storage permission denied.'
      };
    }

    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const writeBlobInChunks = async (
        path: string,
        directory?: typeof Directory[keyof typeof Directory]
      ): Promise<void> => {
        const writeOptions = directory ? { path, directory, recursive: true } : { path, recursive: true };
        if (blob.size <= CAPACITOR_EXPORT_SINGLE_WRITE_BYTES) {
          const base64Data = await blobToBase64(blob);
          await Filesystem.writeFile({
            ...writeOptions,
            data: base64Data
          });
          return;
        }

        let offset = 0;
        let isFirstChunk = true;
        while (offset < blob.size) {
          const nextOffset = Math.min(blob.size, offset + CAPACITOR_EXPORT_CHUNK_BYTES);
          const chunk = blob.slice(offset, nextOffset);
          const base64Data = await blobToBase64(chunk);

          if (isFirstChunk) {
            await Filesystem.writeFile({
              ...writeOptions,
              data: base64Data
            });
            isFirstChunk = false;
          } else {
            if (directory) {
              await Filesystem.appendFile({
                path,
                directory,
                data: base64Data
              });
            } else {
              await Filesystem.appendFile({
                path,
                data: base64Data
              });
            }
          }

          offset = nextOffset;
          if (offset < blob.size) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          }
        }
      };

      if (isNativeAndroid()) {
        const downloadRelativePath = `Download/${normalizedFolder}/${fileName}`;
        const downloadAbsolutePath = `${ANDROID_DOWNLOAD_ROOT}/${normalizedFolder}/${fileName}`;
        try {
          await writeBlobInChunks(downloadAbsolutePath);
          return {
            success: true,
            message: `Successfully saved to ${downloadRelativePath}`,
            savedPath: downloadRelativePath
          };
        } catch (downloadError) {
          console.warn('Download folder write failed, falling back to Documents:', downloadError);
        }
      }

      await writeBlobInChunks(`${normalizedFolder}/${fileName}`, Directory.Documents);
      return {
        success: true,
        message: `Successfully saved to Documents/${normalizedFolder}/${fileName}`,
        savedPath: `Documents/${normalizedFolder}/${fileName}`
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save file.'
      };
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    a.style.display = 'none';
    if (isMobileBrowserRuntime()) {
      a.target = '_blank';
    }
    document.body.appendChild(a);
    try {
      a.click();
    } catch (clickError) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    const cleanupDelayMs = isMobileBrowserRuntime() ? 120000 : 15000;
    window.setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
        if (a.parentNode) a.parentNode.removeChild(a);
      } catch {
        // ignore cleanup errors
      }
    }, cleanupDelayMs);
    return {
      success: true,
      message: `Successfully downloaded ${fileName}`,
      savedPath: fileName
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to trigger download.'
    };
  }
};

const writeOperationDiagnosticsLog = async (
  diagnostics: OperationDiagnostics,
  error: unknown
): Promise<string | null> => {
  try {
    diagnostics.endedAt = new Date().toISOString();
    diagnostics.error = sanitizeOperationError(error);
    const payload = JSON.stringify(diagnostics, null, 2);
    const fileName = `vdjv-${diagnostics.operation}-${diagnostics.operationId}.json`;
    const result = await saveExportFile(
      new Blob([payload], { type: 'application/json' }),
      fileName,
      EXPORT_LOGS_FOLDER
    );
    return result.success ? result.savedPath || fileName : null;
  } catch {
    return null;
  }
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
  exportAppBackup: (payload: {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null };
  }, options?: { riskMode?: boolean }) => Promise<string>;
  restoreAppBackup: (file: File, companionFiles?: File[]) => Promise<{
    message: string;
    settings: Record<string, unknown> | null;
    mappings: Record<string, unknown> | null;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null } | null;
  }>;
  recoverMissingMediaFromBanks: (files: File[]) => Promise<string>;
}

const STORAGE_KEY = 'vdjv-sampler-banks';
const STATE_STORAGE_KEY = 'vdjv-sampler-state';
const DEFAULT_BANK_LOADED_KEY = 'vdjv-default-bank-loaded';
const DEFAULT_BANK_LOADING_LOCK_KEY = 'vdjv-default-bank-loading-lock';
const DEFAULT_BANK_SOURCE_ID = 'vdjv-default-bank-source';
const SESSION_ENFORCEMENT_EVENT_KEY = 'vdjv-session-enforcement-event';
const HIDE_PROTECTED_BANKS_KEY = 'vdjv-hide-protected-banks';
const HIDDEN_PROTECTED_BANKS_CACHE_KEY = 'vdjv-hidden-protected-banks-by-user';

// Shared encryption password for banks with "Allow Export" disabled
// This provides security layer without requiring Supabase or user purchase
// All users (logged in or not) can import these banks
const SHARED_EXPORT_DISABLED_PASSWORD = 'vdjv-export-disabled-2024-secure';

const normalizeIdentityToken = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isDefaultBankIdentity = (bank: Pick<SamplerBank, 'name' | 'sourceBankId'>): boolean =>
  bank.name === 'Default Bank' || bank.sourceBankId === DEFAULT_BANK_SOURCE_ID;

const getBankIdentityToken = (bank: SamplerBank): string | null => {
  if (isDefaultBankIdentity(bank)) return `default:${DEFAULT_BANK_SOURCE_ID}`;

  const sourceId = normalizeIdentityToken(bank.sourceBankId);
  if (sourceId) return `source:${sourceId}`;

  const metadataBankId = normalizeIdentityToken(bank.bankMetadata?.bankId);
  if (metadataBankId) return `meta:${metadataBankId}`;

  return null;
};

const pickPreferredBank = (group: SamplerBank[]): SamplerBank => {
  return [...group].sort((a, b) => {
    const padDiff = (b.pads?.length || 0) - (a.pads?.length || 0);
    if (padDiff !== 0) return padDiff;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  })[0];
};

const dedupeBanksByIdentity = (inputBanks: SamplerBank[]) => {
  const grouped = new Map<string, SamplerBank[]>();
  inputBanks.forEach((bank) => {
    const token = getBankIdentityToken(bank);
    if (!token) return;
    const list = grouped.get(token) || [];
    list.push(bank);
    grouped.set(token, list);
  });

  const removedIdToKeptId = new Map<string, string>();
  grouped.forEach((group) => {
    if (group.length <= 1) return;
    const keepBank = pickPreferredBank(group);
    group.forEach((bank) => {
      if (bank.id === keepBank.id) return;
      removedIdToKeptId.set(bank.id, keepBank.id);
    });
  });

  if (removedIdToKeptId.size === 0) {
    return { banks: inputBanks, removedIdToKeptId };
  }

  return {
    banks: inputBanks.filter((bank) => !removedIdToKeptId.has(bank.id)),
    removedIdToKeptId
  };
};

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

const sanitizePadForPersistentCache = (pad: PadData, padIndex: number): PadData => ({
  ...pad,
  audioUrl: null,
  imageUrl: null,
  imageData: undefined,
  fadeInMs: pad.fadeInMs || 0,
  fadeOutMs: pad.fadeOutMs || 0,
  startTimeMs: pad.startTimeMs || 0,
  endTimeMs: pad.endTimeMs || 0,
  pitch: pad.pitch || 0,
  savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
    ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
    : [null, null, null, null],
  position: pad.position ?? padIndex,
});

const sanitizeBankForPersistentCache = (bank: SamplerBank): SamplerBank => ({
  ...bank,
  pads: (bank.pads || []).map((pad, padIndex) => sanitizePadForPersistentCache(pad, padIndex)),
});

const reviveCachedPad = (pad: any, padIndex: number): PadData => ({
  ...pad,
  fadeInMs: pad.fadeInMs || 0,
  fadeOutMs: pad.fadeOutMs || 0,
  startTimeMs: pad.startTimeMs || 0,
  endTimeMs: pad.endTimeMs || 0,
  pitch: pad.pitch || 0,
  savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
    ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
    : [null, null, null, null],
  position: pad.position ?? padIndex,
});

const reviveCachedBank = (bank: any, index: number): SamplerBank => ({
  ...bank,
  createdAt: bank?.createdAt ? new Date(bank.createdAt) : new Date(),
  sortOrder: bank?.sortOrder ?? index,
  pads: Array.isArray(bank?.pads) ? bank.pads.map((pad: any, padIndex: number) => reviveCachedPad(pad, padIndex)) : [],
});

const readHiddenProtectedBanksCache = (): Record<string, SamplerBank[]> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(HIDDEN_PROTECTED_BANKS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, any[]>;
    const revived: Record<string, SamplerBank[]> = {};
    Object.entries(parsed || {}).forEach(([userId, banks]) => {
      if (!Array.isArray(banks) || !userId) return;
      revived[userId] = banks.map((bank, index) => reviveCachedBank(bank, index));
    });
    return revived;
  } catch {
    return {};
  }
};

const writeHiddenProtectedBanksCache = (cache: Record<string, SamplerBank[]>): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HIDDEN_PROTECTED_BANKS_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.warn('Failed to persist hidden protected banks cache:', error);
  }
};

const normalizeBase64Data = (raw: string): string => {
  const commaIndex = raw.indexOf(',');
  if (commaIndex >= 0) return raw.slice(commaIndex + 1);
  return raw;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      try {
        resolve(normalizeBase64Data(String(reader.result || '')));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const extFromMime = (mime: string, type: 'audio' | 'image'): string => {
  const lower = (mime || '').toLowerCase();
  if (type === 'audio') {
    if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
    if (lower.includes('wav')) return 'wav';
    if (lower.includes('ogg')) return 'ogg';
    if (lower.includes('aac')) return 'aac';
    if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
    return 'bin';
  }
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('gif')) return 'gif';
  return 'bin';
};

const mimeFromExt = (ext: string, type: 'audio' | 'image'): string => {
  const lower = ext.toLowerCase();
  if (type === 'audio') {
    if (lower === 'mp3') return 'audio/mpeg';
    if (lower === 'wav') return 'audio/wav';
    if (lower === 'ogg') return 'audio/ogg';
    if (lower === 'aac') return 'audio/aac';
    if (lower === 'm4a') return 'audio/mp4';
    return 'application/octet-stream';
  }
  if (lower === 'png') return 'image/png';
  if (lower === 'jpg' || lower === 'jpeg') return 'image/jpeg';
  if (lower === 'webp') return 'image/webp';
  if (lower === 'gif') return 'image/gif';
  return 'application/octet-stream';
};

const parseStorageKeyExt = (storageKey: string): string => {
  const idx = storageKey.lastIndexOf('.');
  if (idx < 0) return 'bin';
  return storageKey.slice(idx + 1);
};

const hasZipMagicHeader = async (file: Blob): Promise<boolean> => {
  try {
    const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (bytes.length < 4) return false;
    const isPk = bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isPk) return false;
    return (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
  } catch {
    return false;
  }
};

const normalizePadNameToken = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

const getPadPositionOrFallback = (pad: Partial<PadData>, fallbackIndex: number): number => {
  if (typeof pad.position === 'number' && Number.isFinite(pad.position) && pad.position >= 0) {
    return Math.floor(pad.position);
  }
  return fallbackIndex;
};

const padHasExpectedImageAsset = (pad: Partial<PadData>): boolean => {
  return Boolean(
    pad.hasImageAsset === true ||
    pad.imageStorageKey ||
    pad.imageData ||
    (typeof pad.imageUrl === 'string' && pad.imageUrl.trim().length > 0) ||
    pad.imageBackend === 'native'
  );
};

const ensureStorageHeadroom = async (requiredBytes: number, operation: string): Promise<void> => {
  const unknownStorageLimitBytes =
    operation === 'bank import' || operation === 'backup restore'
      ? MAX_UNKNOWN_STORAGE_IMPORT_BYTES
      : MAX_UNKNOWN_STORAGE_OPERATION_BYTES;

  if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
    if (requiredBytes > unknownStorageLimitBytes) {
      const requiredMb = Math.ceil(requiredBytes / (1024 * 1024));
      throw new Error(`Unable to verify free storage for ${operation}. Operation is too large (${requiredMb}MB) without quota support.`);
    }
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    if (!estimate.quota || !estimate.usage) return;
    const freeBytes = estimate.quota - estimate.usage;
    if (freeBytes < requiredBytes + MIN_FREE_STORAGE_BYTES) {
      const freeMb = Math.floor(freeBytes / (1024 * 1024));
      const neededMb = Math.ceil((requiredBytes + MIN_FREE_STORAGE_BYTES) / (1024 * 1024));
      throw new Error(`Not enough free storage for ${operation}. Free: ${freeMb}MB, required: at least ${neededMb}MB.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Not enough free storage')) {
      throw error;
    }
  }
};

const yieldToMainThread = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const writeNativeMediaBlob = async (padId: string, blob: Blob, type: 'audio' | 'image'): Promise<string | null> => {
  if (!isNativeCapacitorPlatform()) return null;
  const nativeWriteLimitBytes =
    type === 'audio' ? MAX_CAPACITOR_NATIVE_AUDIO_WRITE_BYTES : MAX_CAPACITOR_NATIVE_IMAGE_WRITE_BYTES;
  if (blob.size > nativeWriteLimitBytes) {
    if (!nativeWriteFallbackLogged.has(type)) {
      nativeWriteFallbackLogged.add(type);
      console.warn(
        `[storage] Native ${type} write fallback enabled for large blobs (> ${Math.round(nativeWriteLimitBytes / (1024 * 1024))}MB). Using IndexedDB for stability.`
      );
    }
    return null;
  }
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const ext = extFromMime(blob.type, type);
    const storageKey = `${type}/${padId}.${ext}`;
    const base64 = await blobToBase64(blob);
    await Filesystem.writeFile({
      path: `${NATIVE_MEDIA_ROOT}/${storageKey}`,
      data: base64,
      directory: Directory.Data,
      recursive: true
    });
    return storageKey;
  } catch (error) {
    console.warn(`Failed writing native ${type} media for pad ${padId}:`, error);
    return null;
  }
};

const readNativeMediaBlob = async (storageKey: string, type: 'audio' | 'image'): Promise<Blob | null> => {
  if (!isNativeCapacitorPlatform()) return null;
  try {
    const uri = await getNativeMediaPlaybackUrl(storageKey);
    if (uri) {
      try {
        const response = await fetch(uri, { cache: 'no-store' });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.size > 0) {
            if (blob.type) return blob;
            return new Blob([blob], { type: mimeFromExt(parseStorageKeyExt(storageKey), type) });
          }
        }
      } catch {
        // Fall through to readFile fallback.
      }
    }

    const nativeSize = await readNativeMediaSize(storageKey);
    if (nativeSize > MAX_CAPACITOR_BRIDGE_READ_BYTES) {
      return null;
    }

    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.readFile({
      path: `${NATIVE_MEDIA_ROOT}/${storageKey}`,
      directory: Directory.Data
    });
    const base64 = normalizeBase64Data(String(result.data || ''));
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeFromExt(parseStorageKeyExt(storageKey), type) });
  } catch {
    return null;
  }
};

const getNativeMediaPlaybackUrl = async (storageKey: string): Promise<string | null> => {
  if (!isNativeCapacitorPlatform()) return null;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const uriResult = await Filesystem.getUri({
      path: `${NATIVE_MEDIA_ROOT}/${storageKey}`,
      directory: Directory.Data
    });
    const capacitor = (window as any).Capacitor;
    const convertFileSrc = capacitor?.convertFileSrc;
    return convertFileSrc ? convertFileSrc(uriResult.uri) : uriResult.uri;
  } catch {
    return null;
  }
};

const readNativeMediaSize = async (storageKey?: string | null): Promise<number> => {
  if (!isNativeCapacitorPlatform() || !storageKey) return 0;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const stat = await Filesystem.stat({
      path: `${NATIVE_MEDIA_ROOT}/${storageKey}`,
      directory: Directory.Data
    });
    return Number(stat.size || 0);
  } catch {
    return 0;
  }
};

const deleteNativeMediaBlob = async (storageKey?: string | null): Promise<void> => {
  if (!isNativeCapacitorPlatform() || !storageKey) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.deleteFile({
      path: `${NATIVE_MEDIA_ROOT}/${storageKey}`,
      directory: Directory.Data
    });
  } catch {
    // Ignore missing file errors.
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
    console.log('[audio] MP3 encoding successful');
    return { blob: new Blob([result], { type: 'audio/mp3' }), format: 'mp3' };
  } catch (error) {
    console.warn('[audio] MP3 encoding failed, falling back to WAV:', error);
    return { blob: audioBufferToWavBlob(audioBuffer), format: 'wav' };
  }
};

const trimAudio = async (
  audioBlob: Blob,
  startTimeMs: number,
  endTimeMs: number,
  originalFormat: 'mp3' | 'wav' | 'ogg' | 'unknown'
): Promise<{ blob: Blob; newDurationMs: number }> => {
  console.log(`[audio] trimAudio startMs=${startTimeMs} endMs=${endTimeMs} format=${originalFormat}`);
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

const restoreFileAccess = async (
  padId: string,
  type: 'audio' | 'image',
  storageKey?: string,
  backend?: MediaBackend
): Promise<{ url: string | null; storageKey?: string; backend: MediaBackend }> => {
  const keyPrefix = type === 'image' ? 'image' : 'audio';
  const storageId = `${keyPrefix}_${padId}`;

  if (isNativeCapacitorPlatform() && storageKey) {
    const blob = await readNativeMediaBlob(storageKey, type);
    if (blob) {
      return { url: URL.createObjectURL(blob), storageKey, backend: 'native' };
    }
  }

  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(storageId, type);
      if (handle) {
        const permission = await (handle as any).queryPermission?.();
        if (permission === 'granted') {
          const file = await handle.getFile();
          return { url: URL.createObjectURL(file), storageKey, backend: 'idb' };
        }
      }
    } catch {}
  }

  try {
    const blob = await getBlobFromDB(storageId);
    if (blob) {
      return { url: URL.createObjectURL(blob), storageKey, backend: 'idb' };
    }
  } catch {}

  if (isNativeCapacitorPlatform() && (!storageKey || backend === 'native')) {
    const candidateKeys: string[] = [];
    if (storageKey) {
      candidateKeys.push(storageKey);
    }
    const extensions = type === 'audio' ? ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'bin'] : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bin'];
    extensions.forEach((ext) => candidateKeys.push(`${type}/${padId}.${ext}`));
    for (const candidate of candidateKeys) {
      const blob = await readNativeMediaBlob(candidate, type);
      if (blob) {
        return { url: URL.createObjectURL(blob), storageKey: candidate, backend: 'native' };
      }
    }
  }

  return { url: null, storageKey, backend: backend || (storageKey ? 'native' : 'idb') };
};

const storeFile = async (
  padId: string,
  file: File,
  type: 'audio' | 'image'
): Promise<{ storageKey?: string; backend: MediaBackend }> => {
  if (isNativeCapacitorPlatform()) {
    const nativeKey = await writeNativeMediaBlob(padId, file, type);
    if (nativeKey) return { storageKey: nativeKey, backend: 'native' };
  }

  const keyPrefix = type === 'image' ? 'image' : 'audio';
  const storageId = `${keyPrefix}_${padId}`;
  await saveBlobToDB(storageId, file, type === 'image');
  return { backend: 'idb' };
};

const loadPadMediaBlob = async (pad: PadData, type: 'audio' | 'image'): Promise<Blob | null> => {
  const storageId = `${type}_${pad.id}`;
  const storageKey = type === 'audio' ? pad.audioStorageKey : pad.imageStorageKey;
  if (storageKey) {
    const nativeBlob = await readNativeMediaBlob(storageKey, type);
    if (nativeBlob) return nativeBlob;
  }

  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(storageId, type);
      if (handle && (await (handle as any).queryPermission?.()) === 'granted') {
        const file = await handle.getFile();
        return file;
      }
    } catch {}
  }

  try {
    const blob = await getBlobFromDB(storageId);
    if (blob) return blob;
  } catch {}

  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (mediaUrl) {
    try {
      return await (await fetch(mediaUrl)).blob();
    } catch {}
  }
  return null;
};

const loadPadMediaBlobWithUrlFallback = async (pad: PadData, type: 'audio' | 'image'): Promise<Blob | null> => {
  const stored = await loadPadMediaBlob(pad, type);
  if (stored) return stored;
  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (!mediaUrl) return null;
  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
};

const estimatePadMediaBytes = async (pad: PadData, type: 'audio' | 'image'): Promise<number> => {
  const storageId = `${type}_${pad.id}`;
  const storageKey = type === 'audio' ? pad.audioStorageKey : pad.imageStorageKey;
  if (storageKey) {
    const nativeSize = await readNativeMediaSize(storageKey);
    if (nativeSize > 0) return nativeSize;
  }
  if (supportsFileSystemAccess()) {
    try {
      const handle = await getFileHandle(storageId, type);
      if (handle && (await (handle as any).queryPermission?.()) === 'granted') {
        const file = await handle.getFile();
        if (file?.size) return file.size;
      }
    } catch {}
  }
  try {
    const blob = await getBlobFromDB(storageId);
    if (blob) return blob.size;
  } catch {}
  const mediaUrl = type === 'audio' ? pad.audioUrl : pad.imageUrl;
  if (mediaUrl) {
    try {
      const blob = await (await fetch(mediaUrl)).blob();
      return blob.size;
    } catch {}
  }
  return 0;
};

const estimateBankMediaBytes = async (bank: SamplerBank): Promise<number> => {
  let total = 0;
  for (const pad of bank.pads) {
    total += await estimatePadMediaBytes(pad, 'audio');
    total += await estimatePadMediaBytes(pad, 'image');
  }
  return total;
};

const shouldAttemptTrim = (pad: PadData): boolean => {
  return pad.startTimeMs > 50 && pad.endTimeMs > pad.startTimeMs;
};

export function useSamplerStore(): SamplerStore {
  const { user, profile, loading, sessionConflictReason } = useAuth();
  const [banks, setBanks] = React.useState<SamplerBank[]>([]);
  const banksRef = React.useRef<SamplerBank[]>([]);
  const [isBanksHydrated, setIsBanksHydrated] = React.useState(false);
  const [primaryBankId, setPrimaryBankIdState] = React.useState<string | null>(null);
  const [secondaryBankId, setSecondaryBankIdState] = React.useState<string | null>(null);
  const [currentBankId, setCurrentBankIdState] = React.useState<string | null>(null);
  // Note: Default bank loading is now triggered by user login, not a separate state

  const primaryBank = React.useMemo(() => banks.find(b => b.id === primaryBankId) || null, [banks, primaryBankId]);
  const secondaryBank = React.useMemo(() => banks.find(b => b.id === secondaryBankId) || null, [banks, secondaryBankId]);
  const currentBank = React.useMemo(() => banks.find(b => b.id === currentBankId) || null, [banks, currentBankId]);
  const isDualMode = React.useMemo(() => primaryBankId !== null, [primaryBankId]);
  const hiddenProtectedBanksByUserRef = React.useRef<Record<string, SamplerBank[]>>({});
  const hiddenProtectedBanksFallbackRef = React.useRef<SamplerBank[]>([]);
  const lastAuthenticatedUserIdRef = React.useRef<string | null>(null);
  const attemptedDefaultLoadUserRef = React.useRef<string | null>(null);
  const attemptedDefaultMediaRecoveryUserRef = React.useRef<string | null>(null);

  const setHiddenProtectedBanks = React.useCallback((ownerId: string | null, hiddenBanks: SamplerBank[]) => {
    if (ownerId) {
      const nextHiddenBanks = hiddenBanks.map((bank) => sanitizeBankForPersistentCache(bank));
      if (hiddenBanks.length) {
        hiddenProtectedBanksByUserRef.current[ownerId] = nextHiddenBanks;
      } else {
        delete hiddenProtectedBanksByUserRef.current[ownerId];
      }
      const persisted = readHiddenProtectedBanksCache();
      if (nextHiddenBanks.length) {
        persisted[ownerId] = nextHiddenBanks;
      } else {
        delete persisted[ownerId];
      }
      writeHiddenProtectedBanksCache(persisted);
      return;
    }
    hiddenProtectedBanksFallbackRef.current = hiddenBanks;
  }, []);

  const getHiddenProtectedBanks = React.useCallback((ownerId: string | null): SamplerBank[] => {
    if (ownerId) {
      const inMemory = hiddenProtectedBanksByUserRef.current[ownerId];
      if (inMemory?.length) return inMemory;
      const persisted = readHiddenProtectedBanksCache()[ownerId] || [];
      if (persisted.length) {
        hiddenProtectedBanksByUserRef.current[ownerId] = persisted;
      }
      return persisted;
    }
    return hiddenProtectedBanksFallbackRef.current;
  }, []);

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

  React.useEffect(() => {
    if (user?.id) {
      lastAuthenticatedUserIdRef.current = user.id;
    }
  }, [user?.id]);

  React.useEffect(() => {
    banksRef.current = banks;
  }, [banks]);

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
      const ownerId = user?.id || getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null;
      const visibleIds = new Set(next.map((bank) => bank.id));
      setHiddenProtectedBanks(ownerId, prev.filter((bank) => !visibleIds.has(bank.id)));
      const nextIds = new Set(next.map((bank) => bank.id));
      setPrimaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
      setSecondaryBankIdState((current) => (current && nextIds.has(current) ? current : null));
      setCurrentBankIdState((current) => {
        if (current && nextIds.has(current)) return current;
        return next[0]?.id || null;
      });
      return next;
    });
  }, [user?.id, setHiddenProtectedBanks]);

  const restoreHiddenProtectedBanks = React.useCallback((currentUserId: string | null) => {
    const hidden = getHiddenProtectedBanks(currentUserId);
    if (!hidden.length) return;

    setBanks((prev) => {
      const existing = new Set(prev.map((bank) => bank.id));
      const existingSourceIds = new Set(
        prev
          .map((bank) => bank.sourceBankId)
          .filter((id): id is string => Boolean(id))
      );
      const existingMetadataBankIds = new Set(
        prev
          .map((bank) => bank.bankMetadata?.bankId)
          .filter((id): id is string => Boolean(id))
      );
      const hasDefaultLikeBank = prev.some(
        (bank) => bank.sourceBankId === DEFAULT_BANK_SOURCE_ID || bank.name === 'Default Bank'
      );

      const toRestore = hidden.filter((bank) => {
        if (existing.has(bank.id)) return false;
        if (bank.sourceBankId && existingSourceIds.has(bank.sourceBankId)) return false;
        if (bank.bankMetadata?.bankId && existingMetadataBankIds.has(bank.bankMetadata.bankId)) return false;
        if (
          hasDefaultLikeBank &&
          (bank.sourceBankId === DEFAULT_BANK_SOURCE_ID || bank.name === 'Default Bank')
        ) {
          return false;
        }
        return true;
      });
      if (!toRestore.length) {
        setHiddenProtectedBanks(currentUserId, []);
        return prev;
      }
      setHiddenProtectedBanks(currentUserId, []);
      return [...prev, ...toRestore].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    });
  }, [getHiddenProtectedBanks, setHiddenProtectedBanks]);

  const restoreAllFiles = React.useCallback(async () => {
    setIsBanksHydrated(false);
    if (typeof window === 'undefined') return;
    const savedData = getLocalStorageItemSafe(STORAGE_KEY);
    const savedState = getLocalStorageItemSafe(STATE_STORAGE_KEY);

    if (!savedData) {
      // No saved data - create empty default bank
      // Default bank loading will be triggered separately when user logs in
        const defaultBank: SamplerBank = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 };
      setBanks([defaultBank]); 
      setCurrentBankIdState(defaultBank.id);
      setIsBanksHydrated(true);
        return;
    }
    try {
      const { banks: savedBanks } = JSON.parse(savedData);
      let restoredState = { primaryBankId: null, secondaryBankId: null, currentBankId: null };
      if (savedState) try { restoredState = JSON.parse(savedState); } catch {}

      const applyRestoredState = (nextBanks: SamplerBank[]) => {
        setBanks(nextBanks);
        setPrimaryBankIdState(restoredState.primaryBankId);
        setSecondaryBankIdState(restoredState.secondaryBankId);
        if (restoredState.currentBankId && nextBanks.find((b) => b.id === restoredState.currentBankId)) {
          setCurrentBankIdState(restoredState.currentBankId);
        } else if (nextBanks.length > 0) {
          setCurrentBankIdState(nextBanks[0].id);
        }
        setIsBanksHydrated(true);
      };

      const emitMissingMediaDetected = (candidateBanks: SamplerBank[]) => {
        let missingAudio = 0;
        let missingImages = 0;
        const affectedBanks = new Set<string>();
        candidateBanks.forEach((bank) => {
          bank.pads.forEach((pad) => {
            if (!pad.audioUrl) {
              missingAudio += 1;
              affectedBanks.add(bank.name);
            }
            const expectsImage = padHasExpectedImageAsset(pad);
            if (expectsImage && !pad.imageUrl) {
              missingImages += 1;
              affectedBanks.add(bank.name);
            }
          });
        });
        if (missingAudio > 0 || missingImages > 0) {
          window.dispatchEvent(new CustomEvent('vdjv-missing-media-detected', {
            detail: {
              missingAudio,
              missingImages,
              affectedBanks: Array.from(affectedBanks).slice(0, 20)
            }
          }));
        }
      };

      let restoredBanks: SamplerBank[] = savedBanks.map((bank: any, index: number) => ({
        ...bank,
        createdAt: new Date(bank.createdAt),
        sortOrder: bank.sortOrder ?? index,
        pads: (bank.pads || []).map((pad: any, padIndex: number) => ({
          ...pad,
          audioUrl: null,
          imageUrl: null,
          audioBackend: (pad.audioBackend as MediaBackend | undefined) || (pad.audioStorageKey ? 'native' : 'idb'),
          imageBackend: (pad.imageBackend as MediaBackend | undefined) || (pad.imageStorageKey ? 'native' : undefined),
          hasImageAsset: typeof pad.hasImageAsset === 'boolean'
            ? pad.hasImageAsset
            : Boolean(pad.imageStorageKey || pad.imageData || (typeof pad.imageUrl === 'string' && pad.imageUrl.length > 0)),
          fadeInMs: pad.fadeInMs || 0,
          fadeOutMs: pad.fadeOutMs || 0,
          startTimeMs: pad.startTimeMs || 0,
          endTimeMs: pad.endTimeMs || 0,
          pitch: pad.pitch || 0,
          savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
            ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
            : [null, null, null, null],
          position: pad.position ?? padIndex,
        })),
      }));
      restoredBanks = dedupeBanksByIdentity(restoredBanks).banks;

      const hideProtectedLock =
        typeof window !== 'undefined' && localStorage.getItem(HIDE_PROTECTED_BANKS_KEY) === '1';
      if (hideProtectedLock) {
        const ownerId = getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null;
        const visible = pruneProtectedBanksFromCache(restoredBanks);
        setHiddenProtectedBanks(ownerId, restoredBanks.filter(
          (bank) => !visible.some((visibleBank) => visibleBank.id === bank.id)
        ));
        restoredBanks = visible;
      }

      restoredBanks.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      const totalPads = restoredBanks.reduce((sum, bank) => sum + bank.pads.length, 0);
      const eagerRestoreLimit = isNativeCapacitorPlatform() ? MAX_NATIVE_STARTUP_RESTORE_PADS : 1200;

      if (totalPads > eagerRestoreLimit) {
        emitMissingMediaDetected(restoredBanks);
        applyRestoredState(restoredBanks);
        return;
      }

      restoredBanks = await Promise.all(restoredBanks.map(async (bank) => {
        const restoredPads = await Promise.all(bank.pads.map(async (pad) => {
          const restoredPad: PadData = {
            ...pad,
            savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
              ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
              : [null, null, null, null],
          };
          try {
            const restoredAudio = await restoreFileAccess(
              pad.id,
              'audio',
              pad.audioStorageKey,
              pad.audioBackend
            );
            if (restoredAudio.url) restoredPad.audioUrl = restoredAudio.url;
            if (restoredAudio.storageKey) restoredPad.audioStorageKey = restoredAudio.storageKey;
            restoredPad.audioBackend = restoredAudio.backend;
          } catch {}
          try {
            const restoredImage = await restoreFileAccess(
              pad.id,
              'image',
              pad.imageStorageKey,
              pad.imageBackend
            );
            if (restoredImage.url) restoredPad.imageUrl = restoredImage.url;
            if (restoredImage.storageKey) restoredPad.imageStorageKey = restoredImage.storageKey;
            restoredPad.imageBackend = restoredImage.backend;
            if (restoredImage.url) restoredPad.hasImageAsset = true;
            if (!restoredPad.imageUrl && pad.imageData) {
              try {
                restoredPad.imageUrl = URL.createObjectURL(base64ToBlob(pad.imageData));
                restoredPad.imageBackend = 'idb';
                restoredPad.hasImageAsset = true;
              } catch {}
            }
          } catch {}
          return restoredPad;
        }));
        return { ...bank, pads: restoredPads };
      }));

      emitMissingMediaDetected(restoredBanks);
      applyRestoredState(restoredBanks);
    } catch (error) {
       const defaultBank: SamplerBank = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 };
       setBanks([defaultBank]); setCurrentBankIdState(defaultBank.id); setIsBanksHydrated(true);
    }
  }, [setHiddenProtectedBanks]);

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
    restoreHiddenProtectedBanks(user.id);
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
                audioStorageKey: pad.audioStorageKey,
                audioBackend: pad.audioBackend,
                imageStorageKey: pad.imageStorageKey,
                imageBackend: pad.imageBackend,
                hasImageAsset: pad.hasImageAsset,
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
                ignoreChannel: pad.ignoreChannel,
                savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
                  ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
                  : [null, null, null, null]
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
      await ensureStorageHeadroom(file.size, 'audio upload');
      const padId = generateId();
      const audioUrl = URL.createObjectURL(file);
      const storedAudio = await storeFile(padId, file, 'audio');
      const maxPosition = targetBank.pads.length > 0 ? Math.max(...targetBank.pads.map(p => p.position || 0)) : -1;
      const newPad: PadData = {
        id: padId,
        name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
        audioUrl,
        audioStorageKey: storedAudio.storageKey,
        audioBackend: storedAudio.backend,
        hasImageAsset: false,
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
        ignoreChannel: false,
        savedHotcuesMs: [null, null, null, null]
      };
      const audio = new Audio(audioUrl);
      audio.addEventListener('loadedmetadata', () => {
        newPad.endTimeMs = audio.duration * 1000;
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
        await ensureStorageHeadroom(file.size, 'batch audio upload');
        const padId = generateId();
        const audioUrl = URL.createObjectURL(file);
        let audioStorageKey: string | undefined;
        let audioBackend: MediaBackend = 'idb';
        if (isNativeCapacitorPlatform()) {
          const storedAudio = await storeFile(padId, file, 'audio');
          audioStorageKey = storedAudio.storageKey;
          audioBackend = storedAudio.backend;
        } else {
          batchItems.push({ id: padId, blob: file, type: 'audio' });
        }
        
        maxPosition++;
        const newPad: PadData = {
          id: padId,
          name: trimPadName(file.name.replace(/\.[^/.]+$/, '')),
          audioUrl,
          audioStorageKey,
          audioBackend,
          hasImageAsset: false,
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
          ignoreChannel: false,
          savedHotcuesMs: [null, null, null, null]
        };
        newPads.push(newPad);
        
        const audio = new Audio(audioUrl);
        audio.addEventListener('loadedmetadata', () => {
          newPad.endTimeMs = audio.duration * 1000;
          setBanks(p => [...p]);
        });
      }

      if (!isNativeCapacitorPlatform() && batchItems.length > 0) {
        await saveBatchBlobsToDB(batchItems);
      }
      setBanks(prev => prev.map(b => b.id === targetBankId ? { ...b, pads: [...b.pads, ...newPads] } : b));
    } catch (e) { throw e; }
  }, [banks, getTargetBankId, trimPadName]);

  const updatePad = React.useCallback(async (bankId: string, id: string, updatedPad: PadData) => {
    const existingBank = banks.find((bank) => bank.id === bankId);
    const existingPad = existingBank?.pads.find((pad) => pad.id === id);
    const hadVisibleImage = Boolean(existingPad?.imageUrl || existingPad?.imageData);

    if (updatedPad.imageData && updatedPad.imageData.startsWith('data:')) {
      try {
        const imageBlob = base64ToBlob(updatedPad.imageData);
        await ensureStorageHeadroom(imageBlob.size, 'pad image save');
        if (updatedPad.imageUrl && updatedPad.imageUrl.startsWith('blob:')) URL.revokeObjectURL(updatedPad.imageUrl);
        updatedPad.imageUrl = URL.createObjectURL(imageBlob);
        const storedImage = await storeFile(id, new File([imageBlob], 'image', { type: imageBlob.type }), 'image');
        if (storedImage.storageKey) updatedPad.imageStorageKey = storedImage.storageKey;
        updatedPad.imageBackend = storedImage.backend;
        updatedPad.imageData = undefined;
        updatedPad.hasImageAsset = true;
      } catch (e) {}
    }

    const requestedImageRemoval =
      hadVisibleImage &&
      (!updatedPad.imageUrl || updatedPad.imageUrl.trim().length === 0) &&
      (!updatedPad.imageData || updatedPad.imageData.trim().length === 0);

    if (requestedImageRemoval) {
      try {
        await Promise.all([
          deleteBlobFromDB(`image_${id}`, true),
          deleteFileHandle(`image_${id}`, 'image'),
          deleteNativeMediaBlob(existingPad?.imageStorageKey),
        ]);
      } catch {}
      updatedPad.imageStorageKey = undefined;
      updatedPad.imageBackend = undefined;
      updatedPad.hasImageAsset = false;
    } else {
      updatedPad.hasImageAsset = padHasExpectedImageAsset(updatedPad) || Boolean(existingPad?.hasImageAsset);
    }

    setBanks(prev =>
      prev.map((bank) => {
        if (bank.id !== bankId) return bank;
        const currentPad = bank.pads.find((pad) => pad.id === id);
        const removedShortcut = Boolean(currentPad?.shortcutKey) && !updatedPad.shortcutKey;
        return {
          ...bank,
          disableDefaultPadShortcutLayout: removedShortcut ? true : bank.disableDefaultPadShortcutLayout,
          pads: bank.pads.map((pad) => (pad.id === id ? updatedPad : pad))
        };
      })
    );
  }, [banks]);

  const removePad = React.useCallback(async (bankId: string, id: string) => {
    const existingBank = banks.find((bank) => bank.id === bankId);
    const existingPad = existingBank?.pads.find((pad) => pad.id === id);
    try {
      await Promise.all([
        deleteBlobFromDB(`audio_${id}`, false),
        deleteBlobFromDB(`image_${id}`, true),
        deleteFileHandle(`audio_${id}`, 'audio'),
        deleteFileHandle(`image_${id}`, 'image'),
        deleteNativeMediaBlob(existingPad?.audioStorageKey),
        deleteNativeMediaBlob(existingPad?.imageStorageKey),
      ]);
    } catch (e) {}
    setBanks(prev => prev.map(b => b.id === bankId ? { ...b, pads: b.pads.filter(pad => {
        if (pad.id === id) { if (pad.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.audioUrl); if (pad.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(pad.imageUrl); }
        return pad.id !== id;
      }) } : b));
  }, [banks]);

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
      const ordered = [...prev]
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((bank, index) => ({ ...bank, sortOrder: index }));
      const idx = ordered.findIndex((bank) => bank.id === id);
      if (idx <= 0) return prev;
      [ordered[idx - 1], ordered[idx]] = [ordered[idx], ordered[idx - 1]];
      return ordered.map((bank, index) => ({ ...bank, sortOrder: index }));
    });
  }, []);

  const moveBankDown = React.useCallback((id: string) => {
    setBanks(prev => {
      const ordered = [...prev]
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map((bank, index) => ({ ...bank, sortOrder: index }));
      const idx = ordered.findIndex((bank) => bank.id === id);
      if (idx === -1 || idx >= ordered.length - 1) return prev;
      [ordered[idx], ordered[idx + 1]] = [ordered[idx + 1], ordered[idx]];
      return ordered.map((bank, index) => ({ ...bank, sortOrder: index }));
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
    setBanks(prev =>
      prev.map((bank) => {
        if (bank.id !== id) return bank;
        const next: SamplerBank = { ...bank, ...updates };
        if (bank.shortcutKey && updates.shortcutKey === undefined) {
          next.disableDefaultBankShortcutLayout = true;
        } else if (typeof updates.shortcutKey === 'string' && updates.shortcutKey.trim().length > 0) {
          next.disableDefaultBankShortcutLayout = false;
        }
        return next;
      })
    );
  }, []);

  const deleteBank = React.useCallback(async (id: string) => {
    setBanks(prev => {
      const toDel = prev.find(b => b.id === id);
      if (toDel) {
        toDel.pads.forEach(async (p) => {
          try {
            await Promise.all([
              deleteBlobFromDB(`audio_${p.id}`, false),
              deleteBlobFromDB(`image_${p.id}`, true),
              deleteNativeMediaBlob(p.audioStorageKey),
              deleteNativeMediaBlob(p.imageStorageKey),
            ]);
            if (p.audioUrl?.startsWith('blob:')) URL.revokeObjectURL(p.audioUrl);
            if (p.imageUrl?.startsWith('blob:')) URL.revokeObjectURL(p.imageUrl);
          } catch (e) {}
        });
      }
      const newBanks = prev.filter(b => b.id !== id);
      if (id === primaryBankId) { setPrimaryBankIdState(null); setSecondaryBankIdState(null); if (newBanks.length > 0) setCurrentBankIdState(newBanks[0].id); }
      else if (id === secondaryBankId) setSecondaryBankIdState(null);
      else if (id === currentBankId) setCurrentBankIdState(newBanks.length > 0 ? newBanks[0].id : null);
      if (newBanks.length === 0) { const d = { id: generateId(), name: 'Default Bank', defaultColor: '#3b82f6', pads: [], createdAt: new Date(), sortOrder: 0 }; setCurrentBankIdState(d.id); return [d]; }
      return newBanks;
    });
  }, [primaryBankId, secondaryBankId, currentBankId]);

  // --- STABLE EXPORT BANK ---
  const exportBank = React.useCallback(async (id: string, onProgress?: (progress: number) => void) => {
    const bank = banks.find((b) => b.id === id);
    if (!bank) throw new Error('Bank not found');
    if (bank.exportable === false) throw new Error('Export is disabled for this bank');

    const effectiveUser = user || getCachedUser();
    const diagnostics = createOperationDiagnostics('bank_export', effectiveUser?.id || null);
    addOperationStage(diagnostics, 'start', { bankId: bank.id, bankName: bank.name, padCount: bank.pads.length });

    try {
      onProgress?.(5);
      await ensureExportPermission();

      const estimatedBytes = await estimateBankMediaBytes(bank);
      diagnostics.metrics.estimatedBytes = estimatedBytes;
      addOperationStage(diagnostics, 'preflight', { estimatedBytes });

      if (isNativeCapacitorPlatform() && estimatedBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
        throw new Error(
          `Bank export is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`
        );
      }

      await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'bank export');

      const zip = new JSZip();
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      if (!audioFolder || !imageFolder) throw new Error('Unable to create bank archive folders.');

      const totalMediaItems = Math.max(
        1,
        bank.pads.reduce((count, pad) => count + (pad.audioUrl ? 1 : 0) + (padHasExpectedImageAsset(pad) ? 1 : 0), 0)
      );
      let processedItems = 0;
      let exportedAudio = 0;
      let exportedImages = 0;
      let totalExportBytes = 0;

      const exportPads = bank.pads.map((pad) => ({
        ...pad,
        audioUrl: undefined as string | undefined,
        imageUrl: undefined as string | undefined,
      }));
      const exportPadMap = new Map(exportPads.map((pad) => [pad.id, pad]));

      for (const pad of bank.pads) {
        if (pad.audioUrl) {
          const exportPad = exportPadMap.get(pad.id);
          const sourceBlob = await loadPadMediaBlob(pad, 'audio');
          if (sourceBlob) {
            let audioBlob = sourceBlob;
            if (shouldAttemptTrim(pad)) {
              try {
                const trimResult = await trimAudio(sourceBlob, pad.startTimeMs, pad.endTimeMs, detectAudioFormat(sourceBlob));
                audioBlob = trimResult.blob;
                if (exportPad) {
                  exportPad.startTimeMs = 0;
                  exportPad.endTimeMs = trimResult.newDurationMs;
                }
                addOperationStage(diagnostics, 'audio-trimmed', {
                  padId: pad.id,
                  padName: pad.name || 'Untitled Pad',
                  originalBytes: sourceBlob.size,
                  trimmedBytes: audioBlob.size,
                });
              } catch (trimError) {
                addOperationStage(diagnostics, 'audio-trim-fallback', {
                  padId: pad.id,
                  padName: pad.name || 'Untitled Pad',
                  reason: trimError instanceof Error ? trimError.message : String(trimError),
                });
              }
            }
            audioFolder.file(`${pad.id}.audio`, audioBlob);
            if (exportPad) exportPad.audioUrl = `audio/${pad.id}.audio`;
            exportedAudio += 1;
            totalExportBytes += audioBlob.size;
            if (isNativeCapacitorPlatform() && totalExportBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
              throw new Error('Bank export exceeded mobile size limit during packaging.');
            }
          }
          processedItems += 1;
          onProgress?.(10 + (processedItems / totalMediaItems) * 60);
          if (processedItems % 8 === 0) await yieldToMainThread();
        }

        if (padHasExpectedImageAsset(pad)) {
          const exportPad = exportPadMap.get(pad.id);
          const imageBlob = await loadPadMediaBlob(pad, 'image');
          if (imageBlob) {
            imageFolder.file(`${pad.id}.image`, imageBlob);
            if (exportPad) exportPad.imageUrl = `images/${pad.id}.image`;
            exportedImages += 1;
            totalExportBytes += imageBlob.size;
            if (isNativeCapacitorPlatform() && totalExportBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
              throw new Error('Bank export exceeded mobile size limit during packaging.');
            }
          }
          processedItems += 1;
          onProgress?.(10 + (processedItems / totalMediaItems) * 60);
          if (processedItems % 8 === 0) await yieldToMainThread();
        }
      }

      diagnostics.metrics.processedBytes = totalExportBytes;
      diagnostics.metrics.exportedAudio = exportedAudio;
      diagnostics.metrics.exportedImages = exportedImages;

      const bankData = {
        ...bank,
        createdAt: bank.createdAt.toISOString(),
        pads: exportPads,
        creatorEmail: effectiveUser?.email || undefined,
      };
      zip.file('bank.json', JSON.stringify(bankData, null, 2));

      addOperationStage(diagnostics, 'archive-generate');
      onProgress?.(75);
      const compressionLevel = isNativeCapacitorPlatform() ? 2 : 9;
      const zipBlob = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: compressionLevel }
        },
        (meta) => onProgress?.(75 + meta.percent * 0.2)
      );

      const fileName = `${bank.name.replace(/[^a-z0-9]/gi, '_')}.bank`;
      const saveResult = await saveExportFile(zipBlob, fileName);
      if (!saveResult.success) {
        throw new Error(saveResult.message || 'Failed to save exported bank.');
      }
      addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });

      onProgress?.(100);
      logExportActivity({
        status: 'success',
        bankName: bank.name,
        bankId: bank.id,
        padNames: bank.pads.map((pad) => pad.name || 'Untitled Pad'),
      });
      return saveResult.message || 'Bank exported successfully.';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
      logExportActivity({
        status: 'failed',
        bankName: bank.name,
        bankId: bank.id,
        padNames: bank.pads.map((pad) => pad.name || 'Untitled Pad'),
        errorMessage: logPath ? `${errorMessage} (diagnostics: ${logPath})` : errorMessage,
      });
      throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
    }
  }, [banks, logExportActivity, user]);

  // --- FIXED IMPORT BANK ---
  const importBank = React.useCallback(async (
    file: File,
    onProgress?: (progress: number) => void,
    options?: { allowDuplicateImport?: boolean; skipActivityLog?: boolean }
  ) => {
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

      try {
        await file.slice(0, 64).arrayBuffer();
      } catch (error) {
        if (isFileAccessDeniedError(error)) {
          throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
        }
        throw error;
      }

      await ensureStorageHeadroom(Math.ceil(file.size * 1.2), 'bank import');
      
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
      const looksLikePlainZip = await hasZipMagicHeader(file);
      
      onProgress && onProgress(10);
      
      let contents: JSZip;

      try {
        // Fast-path unencrypted banks only if file starts with ZIP magic bytes.
        if (!looksLikePlainZip) {
          throw new Error('zip_magic_mismatch');
        }
        contents = await loadZipFromBlob(file, 'Zip load');
        console.log('[import] Bank file loaded successfully (unencrypted)');
      } catch (error) {
        if (isFileAccessDeniedError(error)) {
          throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
        }
        if (!looksLikePlainZip) {
          console.log('[import] Encrypted bank detected, skipping plain ZIP parse');
        }
        console.log('[import] Attempting to decrypt bank file...');
        
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
            console.log('[import] Decrypted using shared password (export-disabled encryption)');
          } else {
            throw new Error('Shared password mismatch');
          }
        } catch (e) {
          if (isFileAccessDeniedError(e)) {
            throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
          }
          lastError = e instanceof Error ? e : new Error(String(e));
          console.log('[import] Shared password decryption failed; trying user-specific keys...');
        }
        
        // If shared password didn't work, try user-specific keys (requires login)
        if (!decrypted) {
          // Use cached user if auth state not yet synced
          console.log('[import] Auth check:', { user: !!user, cachedUser: !!getCachedUser(), effectiveUser: !!effectiveUser });
          
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
                console.log('[import] Decrypted using cached key');
                break;
              }
            } catch (e) {
              if (isFileAccessDeniedError(e)) {
                throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
              }
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
                    console.log('[import] Decrypted using hinted bank ID');
                  } else {
                    throw new Error('Hinted ID password mismatch');
                  }
                }
              } catch (e) {
                if (isFileAccessDeniedError(e)) {
                  throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
                }
                lastError = e instanceof Error ? e : new Error(String(e));
                console.warn('Decryption attempt failed with hinted ID:', e);
              }
          }
        }
          
          // Try all accessible banks
        if (!decrypted) {
            try {
              const accessible = await listAccessibleBankIds(effectiveUser.id);
              console.log(`[import] Trying ${accessible.length} accessible banks...`);
              const derivedByBank = await Promise.all(
                accessible.map(async (bankId) => ({
                  bankId,
                  key: await getDerivedKey(bankId, effectiveUser.id)
                }))
              );
           for (const { bankId, key } of derivedByBank) {
                try {
                  if (key) {
                    const headerMatch = await withTimeout(
                      isZipPasswordMatch(file, key),
                      Math.min(adaptiveTimeoutMs, 10_000),
                      'Header check'
                    );
                    if (headerMatch) {
                      const decryptedBlob = await withTimeout(decryptZip(file, key), adaptiveTimeoutMs, 'Decrypt');
                      contents = await loadZipFromBlob(decryptedBlob, 'Zip load');
                      decrypted = true;
                      console.log('[import] Decrypted using accessible bank ID:', bankId);
                      break;
                    }
                  }
                } catch (e) {
                  if (isFileAccessDeniedError(e)) {
                    throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
                  }
                  // Continue to next bank
                }
              }
            } catch (e) {
              console.error('Error checking accessible banks:', e);
            }
           }
        }
        
        if (!decrypted) {
          if (lastError && isFileAccessDeniedError(lastError)) {
            throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
          }
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
        
        console.log('[import] Bank data parsed:', { name: bankData.name, padCount: bankData.pads.length });
        importBankName = bankData.name;
        importPadNames = bankData.pads.map((pad: any) => pad?.name || 'Untitled Pad');
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error('Invalid bank file: bank.json is corrupted or invalid JSON');
        }
        throw error;
      }

      const bankDataId =
        typeof bankData?.id === 'string' && bankData.id.trim().length > 0
          ? bankData.id.trim()
          : undefined;
      const importSignature = getBankDuplicateSignature(bankData);
      
      let metadata: BankMetadata | null = await extractBankMetadata(contents);
      if (metadata) {
        metadata = {
          password: metadata.password ?? false,
          transferable: metadata.transferable ?? true,
          exportable: metadata.exportable,
          bankId: metadata.bankId,
          title: metadata.title,
          description: metadata.description,
          color: metadata.color,
        };
      }
      const metadataBankId = metadata?.bankId || parseBankIdFromFileName(file.name) || undefined;
      if (metadataBankId && !metadata?.bankId) {
        metadata = {
          password: metadata?.password ?? false,
          transferable: metadata?.transferable ?? true,
          exportable: metadata?.exportable,
          bankId: metadataBankId,
          title: metadata?.title,
          description: metadata?.description,
          color: metadata?.color,
        };
      }

      includePadList = !(metadata?.password === true || !!metadataBankId);
      const duplicateTokens = new Set<string>();
      const addDuplicateToken = (value: unknown) => {
        const normalized = normalizeIdentityToken(value);
        if (normalized) duplicateTokens.add(normalized);
      };

      addDuplicateToken(bankDataId);
      addDuplicateToken(metadataBankId);
      addDuplicateToken(importSignature);

      if (!options?.allowDuplicateImport && duplicateTokens.size > 0) {
        const isDuplicate = banks.some((bank) => {
          const bankSignature = getBankDuplicateSignature(bank);
          return [bank.id, bank.sourceBankId, bank.bankMetadata?.bankId, bankSignature]
            .some((token) => {
              const normalized = normalizeIdentityToken(token);
              return normalized ? duplicateTokens.has(normalized) : false;
            });
        });

        if (isDuplicate) {
          throw new Error('This bank is already imported.');
        }
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
            password: metadata?.password ?? false,
            transferable: metadata?.transferable ?? true,
            exportable: metadata?.exportable,
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
        sourceBankId: metadataBankId || bankDataId || importSignature,
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
      const nativeMode = isNativeCapacitorPlatform();
      const concurrentPadCount = nativeMode ? NATIVE_IMPORT_CONCURRENCY : WEB_IMPORT_CONCURRENCY;
      const pendingBatchFilesToStore: BatchFileItem[] = [];
      let pendingBatchBytes = 0;

      const flushPendingBatchFiles = async () => {
        if (nativeMode || pendingBatchFilesToStore.length === 0) return;
        const items = pendingBatchFilesToStore.splice(0, pendingBatchFilesToStore.length);
        pendingBatchBytes = 0;
        try {
          await withTimeout(
            saveBatchBlobsToDB(items),
            adaptiveTimeoutMs,
            'Save batch'
          );
        } catch (e) {
          console.error('[import] Failed to save batch files to database:', e);
          throw new Error(`Failed to save files to storage: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      const processPad = async (padData: any, globalPadIndex: number): Promise<PadData | null> => {
        try {
          const newPadId = generateId();
          const audioFile = contents.file(`audio/${padData.id}.audio`);
          const imageFile = contents.file(`images/${padData.id}.image`);
          let audioUrl: string | null = null;
          let imageUrl: string | null = null;
          let audioStorageKey: string | undefined;
          let imageStorageKey: string | undefined;
          let audioBackend: MediaBackend = 'idb';
          let imageBackend: MediaBackend = 'idb';
          let hasImageAsset = false;

          if (audioFile) {
            try {
              const audioBlob = await withTimeout(
                audioFile.async('blob'),
                adaptiveTimeoutMs,
                'Audio load'
              );

              if (!audioBlob || audioBlob.size === 0) {
                console.warn(`[import] Audio file for pad "${padData.name || padData.id}" is empty`);
              } else {
                if (nativeMode) {
                  const storedAudio = await storeFile(
                    newPadId,
                    new File([audioBlob], `${newPadId}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
                    'audio'
                  );
                  audioStorageKey = storedAudio.storageKey;
                  audioBackend = storedAudio.backend;
                  if (storedAudio.storageKey) {
                    audioUrl = await getNativeMediaPlaybackUrl(storedAudio.storageKey);
                  }
                } else {
                  pendingBatchFilesToStore.push({ id: newPadId, blob: audioBlob, type: 'audio' });
                  pendingBatchBytes += audioBlob.size;
                }
                if (!audioUrl) {
                  audioUrl = await createFastIOSBlobURL(audioBlob);
                }
              }
            } catch (e) {
              console.error(`[import] Failed to load audio for pad "${padData.name || padData.id}":`, e);
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
                console.warn(`[import] Image file for pad "${padData.name || padData.id}" is empty`);
              } else {
                hasImageAsset = true;
                if (nativeMode) {
                  const storedImage = await storeFile(
                    newPadId,
                    new File([imageBlob], `${newPadId}.image`, { type: imageBlob.type || 'application/octet-stream' }),
                    'image'
                  );
                  imageStorageKey = storedImage.storageKey;
                  imageBackend = storedImage.backend;
                  if (storedImage.storageKey) {
                    imageUrl = await getNativeMediaPlaybackUrl(storedImage.storageKey);
                  }
                } else {
                  pendingBatchFilesToStore.push({ id: newPadId, blob: imageBlob, type: 'image' });
                  pendingBatchBytes += imageBlob.size;
                }
                if (!imageUrl) {
                  imageUrl = await createFastIOSBlobURL(imageBlob);
                }
              }
            } catch (e) {
              console.error(`[import] Failed to load image for pad "${padData.name || padData.id}":`, e);
            }
          }

          if (!audioUrl) {
            console.warn(`[import] Skipping pad "${padData.name || padData.id}" - no audio file found`);
            return null;
          }

          return {
            ...padData,
            id: newPadId,
            audioUrl,
            imageUrl,
            audioStorageKey,
            audioBackend,
            imageStorageKey,
            imageBackend,
            hasImageAsset,
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
            savedHotcuesMs: Array.isArray(padData.savedHotcuesMs)
              ? (padData.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
              : [null, null, null, null],
            position: padData.position ?? globalPadIndex,
          };
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          console.error(`[import] Pad import error at index ${globalPadIndex}:`, errorMsg);
          return null;
        }
      };

      for (let i = 0; i < totalPads; i += concurrentPadCount) {
        const chunk = bankData.pads.slice(i, i + concurrentPadCount);
        for (let localIndex = 0; localIndex < chunk.length; localIndex += 1) {
          const globalPadIndex = i + localIndex;
          const processedPad = await processPad(chunk[localIndex], globalPadIndex);
          if (processedPad) {
            newPads.push(processedPad);
          }

          if (!nativeMode && (
            pendingBatchFilesToStore.length >= IMPORT_BATCH_FLUSH_COUNT ||
            pendingBatchBytes >= IMPORT_BATCH_FLUSH_BYTES
          )) {
            await flushPendingBatchFiles();
          }

          const currentProgress = 30 + (((globalPadIndex + 1) / totalPads) * 60);
          onProgress && onProgress(Math.min(95, currentProgress));
          await yieldToMainThread();
        }
      }

      await flushPendingBatchFiles();

      if (newPads.length === 0) {
        console.warn('[import] No valid pads were imported from the bank file');
        throw new Error('No valid pads found in bank file. The bank may be corrupted or empty.');
      }

      newBank.pads = newPads;
      let importedBankRef: SamplerBank = newBank;
      setBanks((prev) => {
        const deduped = dedupeBanksByIdentity([...prev, newBank]);
        const replacementId = deduped.removedIdToKeptId.get(newBank.id);
        if (replacementId) {
          const replacementBank = prev.find((bank) => bank.id === replacementId);
          if (replacementBank) importedBankRef = replacementBank;
        }
        return deduped.banks;
      });
      onProgress && onProgress(100);
      console.log(`[import] Import complete: ${newPads.length} pads loaded from "${importedBankRef.name}"`);
      if (!options?.skipActivityLog) {
        logImportActivity({
          status: 'success',
          bankName: importBankName,
          bankId: importedBankRef.sourceBankId || importedBankRef.id,
          padNames: importPadNames,
          includePadList
        });
      }
      return importedBankRef;

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown import error';
      console.error('[import] Import failed:', errorMessage, e);
      if (!options?.skipActivityLog) {
        logImportActivity({
          status: 'failed',
          bankName: importBankName,
          padNames: importPadNames,
          includePadList,
          errorMessage
        });
      }
      
      // Provide more specific error messages
      if (isFileAccessDeniedError(e) || errorMessage.toLowerCase().includes('cannot read the selected file')) {
        throw new Error(IMPORT_FILE_ACCESS_DENIED_MESSAGE);
      } else if (errorMessage.includes('timeout')) {
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

  // --- STABLE ADMIN EXPORT ---
  const exportAdminBank = React.useCallback(async (
    id: string,
    title: string,
    description: string,
    transferable: boolean,
    addToDatabase: boolean,
    allowExport: boolean,
    onProgress?: (progress: number) => void
  ) => {
    if (!user || profile?.role !== 'admin') throw new Error('Admin only');
    const bank = banks.find((b) => b.id === id);
    if (!bank) throw new Error('Bank not found');

    const diagnostics = createOperationDiagnostics('admin_bank_export', user.id);
    addOperationStage(diagnostics, 'start', {
      bankId: bank.id,
      bankName: bank.name,
      padCount: bank.pads.length,
      addToDatabase,
      allowExport,
      transferable,
    });

    try {
      onProgress?.(5);
      await ensureExportPermission();

      const estimatedBytes = await estimateBankMediaBytes(bank);
      diagnostics.metrics.estimatedBytes = estimatedBytes;
      addOperationStage(diagnostics, 'preflight', { estimatedBytes });

      if (isNativeCapacitorPlatform() && estimatedBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
        throw new Error(
          `Admin bank export is too large for mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Reduce bank size and try again.`
        );
      }

      await ensureStorageHeadroom(Math.ceil(estimatedBytes * 0.35), 'admin bank export');

      const zip = new JSZip();
      const audioFolder = zip.folder('audio');
      const imageFolder = zip.folder('images');
      if (!audioFolder || !imageFolder) throw new Error('Unable to create bank archive folders.');

      const totalMediaItems = Math.max(
        1,
        bank.pads.reduce((count, pad) => count + (pad.audioUrl ? 1 : 0) + (padHasExpectedImageAsset(pad) ? 1 : 0), 0)
      );
      let processedItems = 0;
      let totalExportBytes = 0;
      let exportedAudio = 0;
      let exportedImages = 0;

      const exportPads = bank.pads.map((pad) => ({
        ...pad,
        audioUrl: undefined as string | undefined,
        imageUrl: undefined as string | undefined,
      }));
      const exportPadMap = new Map(exportPads.map((pad) => [pad.id, pad]));

      for (const pad of bank.pads) {
        if (pad.audioUrl) {
          const exportPad = exportPadMap.get(pad.id);
          const sourceBlob = await loadPadMediaBlob(pad, 'audio');
          if (sourceBlob) {
            let audioBlob = sourceBlob;
            if (shouldAttemptTrim(pad)) {
              try {
                const trimResult = await trimAudio(sourceBlob, pad.startTimeMs, pad.endTimeMs, detectAudioFormat(sourceBlob));
                audioBlob = trimResult.blob;
                if (exportPad) {
                  exportPad.startTimeMs = 0;
                  exportPad.endTimeMs = trimResult.newDurationMs;
                }
                addOperationStage(diagnostics, 'audio-trimmed', {
                  padId: pad.id,
                  padName: pad.name || 'Untitled Pad',
                  originalBytes: sourceBlob.size,
                  trimmedBytes: audioBlob.size,
                });
              } catch (trimError) {
                addOperationStage(diagnostics, 'audio-trim-fallback', {
                  padId: pad.id,
                  padName: pad.name || 'Untitled Pad',
                  reason: trimError instanceof Error ? trimError.message : String(trimError),
                });
              }
            }
            audioFolder.file(`${pad.id}.audio`, audioBlob);
            if (exportPad) exportPad.audioUrl = `audio/${pad.id}.audio`;
            exportedAudio += 1;
            totalExportBytes += audioBlob.size;
            if (isNativeCapacitorPlatform() && totalExportBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
              throw new Error('Admin bank export exceeded mobile size limit during packaging.');
            }
          }
          processedItems += 1;
          onProgress?.(10 + (processedItems / totalMediaItems) * 45);
          if (processedItems % 8 === 0) await yieldToMainThread();
        }

        if (padHasExpectedImageAsset(pad)) {
          const exportPad = exportPadMap.get(pad.id);
          const imageBlob = await loadPadMediaBlob(pad, 'image');
          if (imageBlob) {
            imageFolder.file(`${pad.id}.image`, imageBlob);
            if (exportPad) exportPad.imageUrl = `images/${pad.id}.image`;
            exportedImages += 1;
            totalExportBytes += imageBlob.size;
            if (isNativeCapacitorPlatform() && totalExportBytes > MAX_NATIVE_BANK_EXPORT_BYTES) {
              throw new Error('Admin bank export exceeded mobile size limit during packaging.');
            }
          }
          processedItems += 1;
          onProgress?.(10 + (processedItems / totalMediaItems) * 45);
          if (processedItems % 8 === 0) await yieldToMainThread();
        }
      }

      diagnostics.metrics.processedBytes = totalExportBytes;
      diagnostics.metrics.exportedAudio = exportedAudio;
      diagnostics.metrics.exportedImages = exportedImages;

      const bankData = {
        ...bank,
        createdAt: bank.createdAt.toISOString(),
        pads: exportPads,
      };
      zip.file('bank.json', JSON.stringify(bankData, null, 2));

      const normalizedTitle = (title || bank.name || 'Bank').trim();
      const fileName = `${normalizedTitle.replace(/[^a-z0-9]/gi, '_')}.bank`;
      let outputBlob: Blob;

      if (addToDatabase) {
        addOperationStage(diagnostics, 'db-create');
        const { createAdminBankWithDerivedKey } = await import('@/lib/admin-bank-utils');
        const adminBank = await createAdminBankWithDerivedKey(title, description, user.id, bank.defaultColor);
        if (!adminBank) throw new Error('Failed to create admin bank metadata entry.');

        addBankMetadata(zip, {
          password: true,
          transferable,
          exportable: false,
          title,
          description,
          color: bank.defaultColor,
          bankId: adminBank.id,
        });

        try {
          const { supabase } = await import('@/lib/supabase');
          await supabase
            .from('user_bank_access')
            .upsert({ user_id: user.id, bank_id: adminBank.id }, { onConflict: 'user_id,bank_id' as any });
        } catch (upsertError) {
          addOperationStage(diagnostics, 'db-access-upsert-warning', {
            reason: upsertError instanceof Error ? upsertError.message : String(upsertError),
          });
        }

        onProgress?.(65);
        outputBlob = await encryptZip(zip, adminBank.derived_key);
        onProgress?.(88);
      } else {
        addBankMetadata(zip, {
          password: !allowExport,
          transferable,
          exportable: allowExport,
          title,
          description,
          color: bank.defaultColor,
        });

        if (!allowExport) {
          onProgress?.(65);
          outputBlob = await encryptZip(zip, SHARED_EXPORT_DISABLED_PASSWORD);
          onProgress?.(88);
        } else {
          addOperationStage(diagnostics, 'archive-generate');
          onProgress?.(65);
          const compressionLevel = isNativeCapacitorPlatform() ? 2 : 9;
          outputBlob = await zip.generateAsync(
            {
              type: 'blob',
              compression: 'DEFLATE',
              compressionOptions: { level: compressionLevel },
            },
            (meta) => onProgress?.(65 + meta.percent * 0.23)
          );
        }
      }

      const saveResult = await saveExportFile(outputBlob, fileName);
      if (!saveResult.success) {
        throw new Error(saveResult.message || 'Failed to save admin bank export.');
      }
      addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || fileName });
      onProgress?.(100);
      return saveResult.message || 'Admin bank exported successfully.';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
      throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
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

  const clearBankMedia = React.useCallback(async (bank: SamplerBank) => {
    await Promise.all(
      bank.pads.map(async (pad) => {
        try {
          await Promise.all([
            deleteBlobFromDB(`audio_${pad.id}`, false),
            deleteBlobFromDB(`image_${pad.id}`, true),
            deleteNativeMediaBlob(pad.audioStorageKey),
            deleteNativeMediaBlob(pad.imageStorageKey),
          ]);
        } catch {
          // best effort
        }
      })
    );
  }, []);

  const exportAppBackup = React.useCallback(async (payload: {
    settings: Record<string, unknown>;
    mappings: Record<string, unknown>;
    state: { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null };
  }, options?: { riskMode?: boolean }) => {
    const effectiveUser = user || getCachedUser();
    if (!effectiveUser?.id) {
      throw new Error('Please sign in before creating a backup.');
    }

    const diagnostics = createOperationDiagnostics('app_backup_export', effectiveUser.id);
    addOperationStage(diagnostics, 'start', { bankCount: banks.length });
    const riskMode = options?.riskMode === true;

    try {
      await ensureExportPermission();

      let estimatedBytes = 0;
      for (const bank of banks) {
        estimatedBytes += await estimateBankMediaBytes(bank);
      }
      diagnostics.metrics.estimatedBytes = estimatedBytes;
      diagnostics.metrics.bankCount = banks.length;

      if (isNativeCapacitorPlatform() && estimatedBytes > MAX_NATIVE_APP_BACKUP_BYTES) {
        throw new Error(
          `Full backup is too large for reliable mobile export (${Math.ceil(estimatedBytes / (1024 * 1024))}MB). Use desktop full backup or export banks individually.`
        );
      }

      const requiredBytes = Math.ceil(Math.max(estimatedBytes, 1) * 0.45);
      addOperationStage(diagnostics, 'preflight', { estimatedBytes, requiredBytes, riskMode });
      if (!riskMode) {
        await ensureStorageHeadroom(requiredBytes, 'backup export');
      } else {
        addOperationStage(diagnostics, 'preflight-skipped', { reason: 'risk-mode-enabled' });
      }

      const zip = new JSZip();
      const backupBanks: any[] = [];
      let totalMediaBytes = 0;
      let processedPads = 0;
      const totalPads = banks.reduce((sum, bank) => sum + bank.pads.length, 0);

      for (const bank of banks) {
        const bankClone: any = {
          ...bank,
          createdAt: bank.createdAt instanceof Date ? bank.createdAt.toISOString() : bank.createdAt,
          pads: [] as any[]
        };

        for (const pad of bank.pads) {
          const padClone: any = {
            ...pad,
            audioUrl: undefined,
            imageUrl: undefined,
            imageData: undefined,
            audioPath: null,
            imagePath: null,
            audioBackend: pad.audioBackend || (pad.audioStorageKey ? 'native' : 'idb'),
            imageBackend: pad.imageBackend || (pad.imageStorageKey ? 'native' : 'idb'),
          };

          const audioBlob = await loadPadMediaBlob(pad, 'audio');
          if (audioBlob) {
            const audioPath = `media/audio/${bank.id}/${pad.id}.audio`;
            zip.file(audioPath, audioBlob);
            padClone.audioPath = audioPath;
            totalMediaBytes += audioBlob.size;
          }

          const imageBlob = padHasExpectedImageAsset(pad) ? await loadPadMediaBlob(pad, 'image') : null;
          if (imageBlob) {
            const imagePath = `media/images/${bank.id}/${pad.id}.image`;
            zip.file(imagePath, imageBlob);
            padClone.imagePath = imagePath;
            totalMediaBytes += imageBlob.size;
          }

          if (isNativeCapacitorPlatform() && totalMediaBytes > MAX_NATIVE_APP_BACKUP_BYTES) {
            throw new Error('Backup exceeded reliable mobile size limit during packaging. Use desktop full backup or export banks individually.');
          }

          bankClone.pads.push(padClone);
          processedPads += 1;
          if (processedPads % 8 === 0) await yieldToMainThread();
        }

        backupBanks.push(bankClone);
      }

      diagnostics.metrics.processedBytes = totalMediaBytes;
      diagnostics.metrics.padCount = totalPads;

      zip.file(
        'backup.json',
        JSON.stringify(
          {
            version: BACKUP_VERSION,
            exportedAt: new Date().toISOString(),
            userId: effectiveUser.id,
            manifest: {
              schema: 'vdjv-backup',
              mediaPolicy: 'hybrid',
              hasBackendHints: true,
              restoreMode: 'non-destructive-legacy',
            },
            state: payload.state,
            settings: payload.settings,
            mappings: payload.mappings,
            banks: backupBanks
          },
          null,
          2
        )
      );

      addOperationStage(diagnostics, 'encrypt');
      const backupPassword = await derivePassword(`backup-${effectiveUser.id}`);
      const encrypted = await encryptZip(zip, backupPassword);

      const backupId = new Date().toISOString().replace(/[:.]/g, '-');
      const splitParts = splitBlobIntoParts(encrypted, getBackupPartSizeBytes(), backupId);
      addOperationStage(diagnostics, 'split', {
        encryptedBytes: encrypted.size,
        partCount: splitParts.length,
        partSizeBytes: getBackupPartSizeBytes(),
      });

      if (splitParts.length <= 1) {
        const legacyFileName = buildBackupManifestName(backupId);
        const saveResult = await saveExportFile(encrypted, legacyFileName);
        if (!saveResult.success) {
          throw new Error(saveResult.message || 'Failed to save backup file.');
        }
        addOperationStage(diagnostics, 'saved', { path: saveResult.savedPath || legacyFileName, mode: 'legacy-single-file' });
        return saveResult.message || 'Backup exported successfully.';
      }

      for (const part of splitParts) {
        const partResult = await saveExportFile(part.blob, part.fileName);
        if (!partResult.success) {
          throw new Error(partResult.message || `Failed to save backup part ${part.fileName}.`);
        }
        addOperationStage(diagnostics, 'save-part', {
          fileName: part.fileName,
          size: part.blob.size,
          path: partResult.savedPath || part.fileName,
        });
        await yieldToMainThread();
      }

      const manifest: BackupArchiveManifest = {
        schema: BACKUP_MANIFEST_SCHEMA,
        manifestVersion: BACKUP_MANIFEST_VERSION,
        backupVersion: BACKUP_VERSION,
        backupId,
        exportedAt: new Date().toISOString(),
        userId: effectiveUser.id,
        encryptedSize: encrypted.size,
        partSize: getBackupPartSizeBytes(),
        parts: splitParts.map((part) => ({
          index: part.index,
          fileName: part.fileName,
          size: part.blob.size,
          offset: part.offset,
        })),
      };

      const manifestName = buildBackupManifestName(backupId);
      const manifestResult = await saveExportFile(
        new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/octet-stream' }),
        manifestName
      );
      if (!manifestResult.success) {
        throw new Error(manifestResult.message || 'Failed to save backup manifest file.');
      }

      addOperationStage(diagnostics, 'saved', {
        path: manifestResult.savedPath || manifestName,
        mode: 'manifest+parts',
        partCount: splitParts.length,
      });
      return `Backup exported in ${splitParts.length} parts. Restore using "${manifestName}" with all "${BACKUP_PART_EXT}" files.`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
      throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
    }
  }, [banks, user]);

  const restoreAppBackup = React.useCallback(async (file: File, companionFiles: File[] = []) => {
    const effectiveUser = user || getCachedUser();
    if (!effectiveUser?.id) {
      throw new Error('Please sign in before restoring a backup.');
    }

    const diagnostics = createOperationDiagnostics('app_backup_restore', effectiveUser.id);
    addOperationStage(diagnostics, 'start', {
      inputBytes: file.size,
      bankCount: banks.length,
      companionFiles: companionFiles.length,
    });

    try {
      await ensureExportPermission();

      let encryptedInputBlob: Blob = file;
      let resolvedManifest: BackupArchiveManifest | null = null;
      const parsedManifest = await tryParseBackupManifestFile(file);
      if (parsedManifest) {
        if (parsedManifest.userId !== effectiveUser.id) {
          throw new Error('This backup manifest belongs to a different account.');
        }
        const resolved = await resolveManifestBackupBlob(parsedManifest, file, companionFiles, diagnostics);
        if (resolved.missingParts.length > 0) {
          const preview = resolved.missingParts.slice(0, 6).join(', ');
          const moreCount = Math.max(0, resolved.missingParts.length - 6);
          const moreSuffix = moreCount > 0 ? ` and ${moreCount} more` : '';
          throw new Error(
            `Missing backup part files: ${preview}${moreSuffix}. Select "${file.name}" together with all "${BACKUP_PART_EXT}" files.`
          );
        }
        encryptedInputBlob = resolved.encryptedBlob;
        resolvedManifest = parsedManifest;
        addOperationStage(diagnostics, 'manifest-resolved', {
          manifest: file.name,
          resolvedParts: resolved.resolvedParts,
          encryptedBytes: encryptedInputBlob.size,
        });
      }

      await ensureStorageHeadroom(Math.ceil(encryptedInputBlob.size * 1.2), 'backup restore');

      try {
        await encryptedInputBlob.slice(0, 64).arrayBuffer();
      } catch (error) {
        if (isFileAccessDeniedError(error)) {
          throw new Error(BACKUP_FILE_ACCESS_DENIED_MESSAGE);
        }
        throw error;
      }

      const backupPassword = await derivePassword(`backup-${effectiveUser.id}`);
      const decryptedZipBlob = await decryptZip(encryptedInputBlob, backupPassword);
      const zip = await new JSZip().loadAsync(await decryptedZipBlob.arrayBuffer());
      const backupJsonFile = zip.file('backup.json');
      if (!backupJsonFile) {
        throw new Error('Invalid backup: backup.json missing.');
      }

      const backupPayload = JSON.parse(await backupJsonFile.async('string'));
      if (!backupPayload || (backupPayload.version !== BACKUP_VERSION && backupPayload.version !== 1)) {
        throw new Error('Unsupported backup version.');
      }
      if (backupPayload.userId !== effectiveUser.id) {
        throw new Error('This backup belongs to a different account.');
      }

      addOperationStage(diagnostics, 'clear-existing-media', { existingBanks: banks.length });
      for (const bank of banks) {
        await clearBankMedia(bank);
      }

      const restoredBanks: SamplerBank[] = [];
      let restoredMediaBytes = 0;

      for (const bank of backupPayload.banks || []) {
        const restoredPads: PadData[] = [];
        for (const pad of bank.pads || []) {
          let audioUrl = '';
          let imageUrl: string | undefined;
          let audioStorageKey: string | undefined;
          let imageStorageKey: string | undefined;
          let audioBackend: MediaBackend = (pad.audioBackend as MediaBackend | undefined) || (pad.audioStorageKey ? 'native' : 'idb');
          let imageBackend: MediaBackend | undefined = (pad.imageBackend as MediaBackend | undefined) || (pad.imageStorageKey ? 'native' : undefined);
          let hasImageAsset = Boolean(pad.hasImageAsset || pad.imagePath || pad.imageStorageKey || pad.imageData);

          if (pad.audioPath) {
            const audioFile = zip.file(String(pad.audioPath));
            if (audioFile) {
              const audioBlob = await audioFile.async('blob');
              const storedAudio = await storeFile(
                pad.id,
                new File([audioBlob], `${pad.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
                'audio'
              );
              audioStorageKey = storedAudio.storageKey;
              audioBackend = storedAudio.backend;
              audioUrl = URL.createObjectURL(audioBlob);
              restoredMediaBytes += audioBlob.size;
            }
          }

          if (pad.imagePath) {
            const imageFile = zip.file(String(pad.imagePath));
            if (imageFile) {
              const imageBlob = await imageFile.async('blob');
              const storedImage = await storeFile(
                pad.id,
                new File([imageBlob], `${pad.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
                'image'
              );
              imageStorageKey = storedImage.storageKey;
              imageBackend = storedImage.backend;
              imageUrl = URL.createObjectURL(imageBlob);
              hasImageAsset = true;
              restoredMediaBytes += imageBlob.size;
            }
          }

          restoredPads.push({
            ...pad,
            audioUrl,
            imageUrl,
            audioStorageKey,
            audioBackend,
            imageStorageKey,
            imageBackend,
            hasImageAsset,
            imageData: undefined,
            savedHotcuesMs: Array.isArray(pad.savedHotcuesMs)
              ? (pad.savedHotcuesMs.slice(0, 4) as [number | null, number | null, number | null, number | null])
              : [null, null, null, null],
          } as PadData);

          if (restoredPads.length % 8 === 0) await yieldToMainThread();
        }

        restoredBanks.push({
          ...bank,
          createdAt: new Date(bank.createdAt || Date.now()),
          pads: restoredPads,
        } as SamplerBank);
      }

      diagnostics.metrics.processedBytes = restoredMediaBytes;
      diagnostics.metrics.restoredBanks = restoredBanks.length;

      setBanks(restoredBanks);

      const restoredState = backupPayload.state || null;
      if (restoredState) {
        const bankIds = new Set(restoredBanks.map((b) => b.id));
        setPrimaryBankIdState(bankIds.has(restoredState.primaryBankId) ? restoredState.primaryBankId : null);
        setSecondaryBankIdState(bankIds.has(restoredState.secondaryBankId) ? restoredState.secondaryBankId : null);
        if (bankIds.has(restoredState.currentBankId)) {
          setCurrentBankIdState(restoredState.currentBankId);
        } else {
          setCurrentBankIdState(restoredBanks[0]?.id || null);
        }
      } else {
        setPrimaryBankIdState(null);
        setSecondaryBankIdState(null);
        setCurrentBankIdState(restoredBanks[0]?.id || null);
      }

      addOperationStage(diagnostics, 'complete', { restoredBanks: restoredBanks.length });
      return {
        message: resolvedManifest
          ? `Backup restored: ${restoredBanks.length} bank(s) from ${resolvedManifest.parts.length} part file(s).`
          : `Backup restored: ${restoredBanks.length} bank(s).`,
        settings: (backupPayload.settings || null) as Record<string, unknown> | null,
        mappings: (backupPayload.mappings || null) as Record<string, unknown> | null,
        state: (backupPayload.state || null) as { primaryBankId: string | null; secondaryBankId: string | null; currentBankId: string | null } | null,
      };
    } catch (error) {
      const normalizedError = isFileAccessDeniedError(error)
        ? new Error(BACKUP_FILE_ACCESS_DENIED_MESSAGE)
        : error;
      const errorMessage = normalizedError instanceof Error ? normalizedError.message : String(normalizedError);
      const logPath = await writeOperationDiagnosticsLog(diagnostics, error);
      throw new Error(logPath ? `${errorMessage} (Diagnostics log: ${logPath})` : errorMessage);
    }
  }, [banks, clearBankMedia, user]);

  const mergeImportedBankMissingMedia = React.useCallback(async (
    imported: SamplerBank,
    options?: { ownerId?: string | null; addAsNewWhenNoTarget?: boolean }
  ): Promise<{ merged: boolean; recoveredItems: number; addedBank: boolean }> => {
    const ownerId = options?.ownerId ?? user?.id ?? getCachedUser()?.id ?? lastAuthenticatedUserIdRef.current ?? null;
    const addAsNewWhenNoTarget = options?.addAsNewWhenNoTarget !== false;
    let recoveredItems = 0;

    const visibleBanks = banksRef.current;
    let hiddenProtected = getHiddenProtectedBanks(ownerId);
    const combinedBanks = [
      ...visibleBanks,
      ...hiddenProtected.filter((hiddenBank) => !visibleBanks.some((visibleBank) => visibleBank.id === hiddenBank.id)),
    ];
    const target = combinedBanks.find((bank) => {
      if (bank.id === imported.id) return false;
      if (imported.sourceBankId && (bank.sourceBankId === imported.sourceBankId || bank.id === imported.sourceBankId)) return true;
      return bank.name === imported.name;
    });

    if (!target) {
      if (!addAsNewWhenNoTarget) {
        await clearBankMedia(imported);
        setBanks((prev) => prev.filter((bank) => bank.id !== imported.id));
        if (ownerId) {
          hiddenProtected = hiddenProtected.filter((bank) => bank.id !== imported.id);
          setHiddenProtectedBanks(ownerId, hiddenProtected);
        }
      }
      return { merged: false, recoveredItems: 0, addedBank: addAsNewWhenNoTarget };
    }

    const sourceById = new Map(imported.pads.map((pad) => [pad.id, pad] as const));
    const sourceByPosition = new Map<number, PadData>();
    const sourceByName = new Map<string, PadData[]>();
    imported.pads.forEach((pad, sourceIndex) => {
      const position = getPadPositionOrFallback(pad, sourceIndex);
      if (!sourceByPosition.has(position)) sourceByPosition.set(position, pad);
      const nameToken = normalizePadNameToken(pad.name);
      if (!nameToken) return;
      const bucket = sourceByName.get(nameToken) || [];
      bucket.push(pad);
      sourceByName.set(nameToken, bucket);
    });

    const updatedPads: PadData[] = [];
    for (let targetIndex = 0; targetIndex < target.pads.length; targetIndex += 1) {
      const targetPad = target.pads[targetIndex];
      const targetPosition = getPadPositionOrFallback(targetPad, targetIndex);
      const targetNameToken = normalizePadNameToken(targetPad.name);
      const bucket = targetNameToken ? sourceByName.get(targetNameToken) : undefined;
      const sourcePad =
        sourceById.get(targetPad.id) ||
        (bucket && bucket.length > 0 ? bucket.shift() : undefined) ||
        sourceByPosition.get(targetPosition) ||
        imported.pads[targetIndex] ||
        imported.pads[targetPosition];
      let nextPad = { ...targetPad };

      const existingAudioBlob = await loadPadMediaBlob(nextPad, 'audio');
      if (existingAudioBlob && !nextPad.audioUrl) {
        nextPad.audioUrl = URL.createObjectURL(existingAudioBlob);
        nextPad.audioBackend = nextPad.audioStorageKey ? 'native' : (nextPad.audioBackend || 'idb');
      }

      if (!existingAudioBlob && sourcePad) {
        try {
          const audioBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'audio');
          if (!audioBlob) throw new Error('Missing source audio blob');
          const storedAudio = await storeFile(
            nextPad.id,
            new File([audioBlob], `${nextPad.id}.audio`, { type: audioBlob.type || 'application/octet-stream' }),
            'audio'
          );
          nextPad.audioUrl = URL.createObjectURL(audioBlob);
          if (storedAudio.storageKey) nextPad.audioStorageKey = storedAudio.storageKey;
          nextPad.audioBackend = storedAudio.backend;
          recoveredItems += 1;
        } catch (error) {
          console.warn('Failed recovering audio for pad:', nextPad.id, error);
        }
      }

      const expectsImage = padHasExpectedImageAsset(nextPad);
      const existingImageBlob = expectsImage ? await loadPadMediaBlob(nextPad, 'image') : null;
      if (existingImageBlob && !nextPad.imageUrl) {
        nextPad.imageUrl = URL.createObjectURL(existingImageBlob);
        nextPad.imageBackend = nextPad.imageStorageKey ? 'native' : (nextPad.imageBackend || 'idb');
        nextPad.hasImageAsset = true;
      }

      if (expectsImage && !existingImageBlob && sourcePad) {
        try {
          const imageBlob = await loadPadMediaBlobWithUrlFallback(sourcePad, 'image');
          if (!imageBlob) throw new Error('Missing source image blob');
          const storedImage = await storeFile(
            nextPad.id,
            new File([imageBlob], `${nextPad.id}.image`, { type: imageBlob.type || 'application/octet-stream' }),
            'image'
          );
          nextPad.imageUrl = URL.createObjectURL(imageBlob);
          if (storedImage.storageKey) nextPad.imageStorageKey = storedImage.storageKey;
          nextPad.imageBackend = storedImage.backend;
          nextPad.hasImageAsset = true;
          recoveredItems += 1;
        } catch (error) {
          console.warn('Failed recovering image for pad:', nextPad.id, error);
        }
      }

      updatedPads.push(nextPad);
    }

    await clearBankMedia(imported);
    setBanks((prev) =>
      prev
        .map((bank) => (bank.id === target.id ? { ...bank, pads: updatedPads } : bank))
        .filter((bank) => bank.id !== imported.id)
    );
    if (ownerId) {
      const hiddenUpdated = hiddenProtected
        .map((bank) => (bank.id === target.id ? { ...bank, pads: updatedPads } : bank))
        .filter((bank) => bank.id !== imported.id);
      setHiddenProtectedBanks(ownerId, hiddenUpdated);
    }

    return { merged: true, recoveredItems, addedBank: false };
  }, [clearBankMedia, getHiddenProtectedBanks, setHiddenProtectedBanks, user?.id]);

  const recoverMissingMediaFromBanks = React.useCallback(async (files: File[]) => {
    if (!files.length) throw new Error('No bank files selected.');

    let recoveredItems = 0;
    let mergedBanks = 0;
    let addedBanks = 0;
    const ownerId = user?.id || getCachedUser()?.id || lastAuthenticatedUserIdRef.current || null;

    for (const file of files) {
      if (!file.name.endsWith('.bank')) continue;
      let imported: SamplerBank | null = null;
      try {
        imported = await importBank(file, undefined, { allowDuplicateImport: true, skipActivityLog: true });
      } catch (error) {
        console.warn(`Recovery import failed for ${file.name}:`, error);
        continue;
      }
      if (!imported) continue;
      const mergeResult = await mergeImportedBankMissingMedia(imported, {
        ownerId,
        addAsNewWhenNoTarget: true,
      });
      if (mergeResult.merged) mergedBanks += 1;
      if (mergeResult.addedBank) addedBanks += 1;
      recoveredItems += mergeResult.recoveredItems;
    }

    return `Recovery complete. Merged ${mergedBanks} bank(s), restored ${recoveredItems} missing pad media item(s), added ${addedBanks} new bank(s).`;
  }, [importBank, mergeImportedBankMissingMedia, user?.id]);

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
      attemptedDefaultMediaRecoveryUserRef.current = null;
      return;
    }

    if (!isBanksHydrated) {
      return;
    }

    const userDefaultBankKey = `${DEFAULT_BANK_LOADED_KEY}_${currentUserId}`;
    const isDefaultBankLike = (bank: SamplerBank) =>
      bank.name === 'Default Bank' || bank.sourceBankId === DEFAULT_BANK_SOURCE_ID;
    const hasPads = (bank: SamplerBank) => Array.isArray(bank.pads) && bank.pads.length > 0;
    const hiddenOwnedByCurrentUser = getHiddenProtectedBanks(currentUserId);
    const hiddenHasDefaultBank = hiddenOwnedByCurrentUser.some(
      (bank) => isDefaultBankLike(bank) && hasPads(bank)
    );

    const dedupedBanks = dedupeBanksByIdentity(banks);
    if (dedupedBanks.removedIdToKeptId.size > 0) {
      setBanks(dedupedBanks.banks);
      setCurrentBankIdState((current) => {
        if (!current) return current;
        return dedupedBanks.removedIdToKeptId.get(current) || current;
      });
      setPrimaryBankIdState((current) => {
        if (!current) return current;
        return dedupedBanks.removedIdToKeptId.get(current) || current;
      });
      setSecondaryBankIdState((current) => {
        if (!current) return current;
        return dedupedBanks.removedIdToKeptId.get(current) || current;
      });
      const hasDefaultAfterDedupe = dedupedBanks.banks.some((bank) => isDefaultBankLike(bank) && hasPads(bank));
      if (hasDefaultAfterDedupe) {
        setLocalStorageItemSafe(userDefaultBankKey, 'true');
      }
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

    const alreadyLoaded = getLocalStorageItemSafe(userDefaultBankKey);
    const hasExistingDefaultBank = banks.some(
      (bank) =>
        isDefaultBankLike(bank) && hasPads(bank)
    );
    const hasEffectiveDefaultBank = hasExistingDefaultBank || hiddenHasDefaultBank;
    if (alreadyLoaded && hasExistingDefaultBank) {
      return;
    }
    if (alreadyLoaded && !hasExistingDefaultBank) {
      try {
        localStorage.removeItem(userDefaultBankKey);
      } catch {}
    }
    if (hasEffectiveDefaultBank) {
      setLocalStorageItemSafe(userDefaultBankKey, 'true');
      return;
    }

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
          (bank) =>
            isDefaultBankLike(bank) && hasPads(bank)
        );
        const hiddenStillHasDefault = getHiddenProtectedBanks(currentUserId)
          .some((bank) => isDefaultBankLike(bank) && hasPads(bank));
        if (hasNonEmptyDefault) {
          setLocalStorageItemSafe(userDefaultBankKey, 'true');
          return;
        }
        if (hiddenStillHasDefault) {
          setLocalStorageItemSafe(userDefaultBankKey, 'true');
          return;
        }

        // Find and delete empty "Default Bank" if it exists
        const emptyDefaultBank = banks.find(
          (b) =>
            isDefaultBankLike(b) && (!b.pads || b.pads.length === 0)
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
          // Keep a stable source id and collapse races where another default bank appears in parallel.
          let resolvedDefaultId = importedBank.id;
          setBanks((prev) => {
            const tagged = prev.map((bank) =>
              bank.id === importedBank.id
                ? { ...bank, name: 'Default Bank', sourceBankId: DEFAULT_BANK_SOURCE_ID }
                : bank
            );
            const defaultLikeBanks = tagged.filter(
              (bank) => bank.name === 'Default Bank' || bank.sourceBankId === DEFAULT_BANK_SOURCE_ID
            );
            if (defaultLikeBanks.length <= 1) return tagged;
            const keepBank =
              defaultLikeBanks.find((bank) => hasPads(bank)) ||
              defaultLikeBanks.find((bank) => bank.id === importedBank.id) ||
              defaultLikeBanks[0];
            resolvedDefaultId = keepBank.id;
            const removeIds = new Set(
              defaultLikeBanks.filter((bank) => bank.id !== keepBank.id).map((bank) => bank.id)
            );
            return tagged.filter((bank) => !removeIds.has(bank.id));
          });
          setCurrentBankIdState(resolvedDefaultId);
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

    loadDefaultBank();
  }, [user?.id, importBank, getDefaultBankPath, banks, currentBankId, isBanksHydrated, getHiddenProtectedBanks]);

  React.useEffect(() => {
    const currentUser = user || getCachedUser();
    const currentUserId = currentUser?.id || null;
    if (!currentUserId || !isBanksHydrated) {
      if (!currentUserId) attemptedDefaultMediaRecoveryUserRef.current = null;
      return;
    }
    if (attemptedDefaultMediaRecoveryUserRef.current === currentUserId) return;

    const defaultBank = banks.find(
      (bank) => bank.sourceBankId === DEFAULT_BANK_SOURCE_ID || bank.name === 'Default Bank'
    );
    if (!defaultBank || !defaultBank.pads.length) return;

    const hasLikelyMissingMedia = defaultBank.pads.some((pad) => {
      if (!pad.audioUrl) return true;
      const expectsImage = padHasExpectedImageAsset(pad);
      return expectsImage && !pad.imageUrl;
    });
    if (!hasLikelyMissingMedia) {
      attemptedDefaultMediaRecoveryUserRef.current = currentUserId;
      return;
    }

    attemptedDefaultMediaRecoveryUserRef.current = currentUserId;
    let cancelled = false;
    const recoverDefaultMedia = async () => {
      try {
        const basePath = getDefaultBankPath();
        let response = await fetch(basePath);
        if (!response.ok && /Android/.test(navigator.userAgent) && basePath.startsWith('/')) {
          response = await fetch('./assets/DEFAULT_BANK.bank');
        }
        if (!response.ok && window.navigator.userAgent.includes('Electron') && basePath.startsWith('./')) {
          response = await fetch('/assets/DEFAULT_BANK.bank');
        }
        if (!response.ok) {
          throw new Error(`Default bank file not found: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Default bank file is empty');

        const file = new File([blob], 'DEFAULT_BANK.bank', { type: 'application/zip' });
        const importedBank = await importBank(file, undefined, {
          allowDuplicateImport: true,
          skipActivityLog: true,
        });
        if (!importedBank || cancelled) return;

        const importedDefault = {
          ...importedBank,
          name: 'Default Bank',
          sourceBankId: DEFAULT_BANK_SOURCE_ID,
        };
        const result = await mergeImportedBankMissingMedia(importedDefault, {
          ownerId: currentUserId,
          addAsNewWhenNoTarget: false,
        });
        if (result.merged && result.recoveredItems > 0) {
          console.log(`[default-recovery] Restored ${result.recoveredItems} missing media item(s) from embedded default bank.`);
        }
      } catch (error) {
        console.warn('Default bank media auto-recovery failed:', error);
      }
    };

    void recoverDefaultMedia();
    return () => {
      cancelled = true;
    };
  }, [
    user?.id,
    banks,
    isBanksHydrated,
    getDefaultBankPath,
    importBank,
    mergeImportedBankMissingMedia,
  ]);


  return {
    banks, primaryBankId, secondaryBankId, currentBankId, primaryBank, secondaryBank, currentBank, isDualMode,
    addPad, addPads, updatePad, removePad, createBank, setPrimaryBank, setSecondaryBank, setCurrentBank, updateBank, deleteBank, importBank, exportBank, reorderPads, moveBankUp, moveBankDown, transferPad, exportAdminBank, canTransferFromBank,
    exportAppBackup, restoreAppBackup, recoverMissingMediaFromBanks,
  };
}
