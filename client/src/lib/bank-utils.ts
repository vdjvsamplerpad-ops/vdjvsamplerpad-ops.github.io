import JSZip from 'jszip';
import { supabase } from './supabase';
import { BankMetadata, AdminBank, UserBankAccess } from '@/components/sampler/types/sampler';

// Secret key for deriving passwords (in production, this should be in environment variables)
const SECRET_KEY = 'vdjv-sampler-secret-2024';

// Cache for derived keys to avoid repeated database calls
const keyCache = new Map<string, string>();

// Export keyCache for use in other modules
export { keyCache };

// LocalStorage keys for offline caching
const ACCESSIBLE_BANKS_CACHE_KEY = 'vdjv-accessible-banks';
const BANK_KEYS_CACHE_KEY = 'vdjv-bank-derived-keys';

interface CachedAccessibleBanks {
  userId: string;
  bankIds: string[];
  timestamp: number;
}

interface CachedBankKeys {
  userId: string;
  keys: Record<string, string>; // bankId -> derivedKey
  timestamp: number;
}

// Helper to get cached accessible banks
function getCachedAccessibleBanks(userId: string): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(ACCESSIBLE_BANKS_CACHE_KEY);
    if (!cached) return null;
    const data: CachedAccessibleBanks = JSON.parse(cached);
    // Check if cache is for the same user
    if (data.userId !== userId) return null;
    // Cache is valid for 24 hours
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null;
    return data.bankIds;
  } catch {
    return null;
  }
}

// Helper to cache accessible banks
function setCachedAccessibleBanks(userId: string, bankIds: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedAccessibleBanks = { userId, bankIds, timestamp: Date.now() };
    localStorage.setItem(ACCESSIBLE_BANKS_CACHE_KEY, JSON.stringify(data));
    console.log('✅ Cached accessible banks:', bankIds.length);
  } catch (e) {
    console.warn('Failed to cache accessible banks:', e);
  }
}

// Helper to get cached bank derived keys
function getCachedBankKeys(userId: string): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(BANK_KEYS_CACHE_KEY);
    if (!cached) return null;
    const data: CachedBankKeys = JSON.parse(cached);
    if (data.userId !== userId) return null;
    // Cache is valid for 24 hours
    if (Date.now() - data.timestamp > 24 * 60 * 60 * 1000) return null;
    return data.keys;
  } catch {
    return null;
  }
}

// Helper to cache bank derived keys
function setCachedBankKeys(userId: string, keys: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedBankKeys = { userId, keys, timestamp: Date.now() };
    localStorage.setItem(BANK_KEYS_CACHE_KEY, JSON.stringify(data));

  } catch (e) {
    console.warn('Failed to cache bank keys:', e);
  }
}

// Helper to update cached bank keys with a new key
function addToCachedBankKeys(userId: string, bankId: string, derivedKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    let data: CachedBankKeys;
    const cached = localStorage.getItem(BANK_KEYS_CACHE_KEY);
    if (cached) {
      data = JSON.parse(cached);
      if (data.userId === userId) {
        data.keys[bankId] = derivedKey;
        data.timestamp = Date.now();
      } else {
        data = { userId, keys: { [bankId]: derivedKey }, timestamp: Date.now() };
      }
    } else {
      data = { userId, keys: { [bankId]: derivedKey }, timestamp: Date.now() };
    }
    localStorage.setItem(BANK_KEYS_CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to add to cached bank keys:', e);
  }
}

/**
 * Derive password from bank ID using SHA-256
 */
export async function derivePassword(bankId: string): Promise<string> {
  const message = bankId + SECRET_KEY;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Encrypt a zip file with a password
 */
export async function encryptZip(zip: JSZip, password: string): Promise<Blob> {
  // JSZip doesn't support encryption directly, so we'll use a simple XOR encryption
  // In production, you might want to use a more robust encryption library
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  
  // Convert blob to array buffer
  const arrayBuffer = await zipBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Simple XOR encryption with password
  const passwordBytes = new TextEncoder().encode(password);
  for (let i = 0; i < uint8Array.length; i++) {
    uint8Array[i] ^= passwordBytes[i % passwordBytes.length];
  }
  
  return new Blob([uint8Array], { type: 'application/octet-stream' });
}

/**
 * Decrypt a zip file with a password
 */
export async function decryptZip(encryptedBlob: Blob, password: string): Promise<Blob> {
  // Convert blob to array buffer
  const arrayBuffer = await encryptedBlob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Simple XOR decryption with password
  const passwordBytes = new TextEncoder().encode(password);
  for (let i = 0; i < uint8Array.length; i++) {
    uint8Array[i] ^= passwordBytes[i % passwordBytes.length];
  }
  
  return new Blob([uint8Array], { type: 'application/zip' });
}

/**
 * Validate a password by decrypting only the ZIP header (avoids full-file decrypt)
 */
export async function isZipPasswordMatch(encryptedBlob: Blob, password: string): Promise<boolean> {
  try {
    const headerSlice = encryptedBlob.slice(0, 8);
    const arrayBuffer = await headerSlice.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const passwordBytes = new TextEncoder().encode(password);

    for (let i = 0; i < uint8Array.length; i++) {
      uint8Array[i] ^= passwordBytes[i % passwordBytes.length];
    }

    const sig0 = uint8Array[0];
    const sig1 = uint8Array[1];
    const sig2 = uint8Array[2];
    const sig3 = uint8Array[3];

    const isZipSignature =
      sig0 === 0x50 &&
      sig1 === 0x4b &&
      ((sig2 === 0x03 && sig3 === 0x04) || (sig2 === 0x05 && sig3 === 0x06) || (sig2 === 0x07 && sig3 === 0x08));

    return isZipSignature;
  } catch (e) {
    return false;
  }
}

/**
 * Get derived key for a bank from cache or database
 * Falls back to localStorage cache when offline
 */
export async function getDerivedKey(bankId: string, userId: string): Promise<string | null> {
  // Check memory cache first
  const cacheKey = `${userId}-${bankId}`;
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey)!;
  }

  // Check localStorage cache (for offline support)
  const cachedKeys = getCachedBankKeys(userId);
  if (cachedKeys && cachedKeys[bankId]) {
    const derivedKey = cachedKeys[bankId];
    keyCache.set(cacheKey, derivedKey); // Populate memory cache

    return derivedKey;
  }

  try {
    // Check if user has access to this bank
    const { data: access, error } = await supabase
      .from('user_bank_access')
      .select('*')
      .eq('user_id', userId)
      .eq('bank_id', bankId)
      .maybeSingle();

    if (error || !access) {
      return null;
    }

    // Get bank details to get derived_key
    const { data: bank, error: bankError } = await supabase
      .from('banks')
      .select('derived_key')
      .eq('id', bankId)
      .maybeSingle();

    if (bankError || !bank) {
      return null;
    }

    // Cache the derived key in memory and localStorage
    keyCache.set(cacheKey, bank.derived_key);
    addToCachedBankKeys(userId, bankId, bank.derived_key);
    
    return bank.derived_key;
  } catch (error) {
    console.error('Error getting derived key:', error);
    // Try localStorage cache as fallback when network fails
    const fallbackKeys = getCachedBankKeys(userId);
    if (fallbackKeys && fallbackKeys[bankId]) {
      console.log('⚠️ Network failed, using cached key for:', bankId);
      return fallbackKeys[bankId];
    }
    return null;
  }
}

/**
 * Create admin bank in database
 */
// Create admin bank, then derive key from the created DB id, update row, and return final row
export async function createAdminBankWithDerivedKey(
  title: string,
  description: string,
  createdBy: string,
): Promise<AdminBank | null> {
  try {
    const { data: created, error: insertErr } = await supabase
      .from('banks')
      .insert({
        title,
        description,
        created_by: createdBy,
      })
      .select('*')
      .single();

    if (insertErr || !created) {
      console.error('[BANK][EXPORT] Insert failed', insertErr);
      return null;
    }

    const bankId: string = created.id;
    const derivedKey = await derivePassword(bankId);

    const { data: updated, error: updateErr } = await supabase
      .from('banks')
      .update({ derived_key: derivedKey })
      .eq('id', bankId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      console.error('[BANK][EXPORT] Update derived_key failed', updateErr);
      return null;
    }

    return updated as AdminBank;
  } catch (error) {
    console.error('Error creating admin bank with derived key:', error);
    return null;
  }
}

/**
 * Grant user access to a bank
 */
export async function grantBankAccess(userId: string, bankId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('user_bank_access')
      .insert({
        user_id: userId,
        bank_id: bankId
      });

    if (error) {
      console.error('Error granting bank access:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error granting bank access:', error);
    return false;
  }
}

/**
 * Check if user has access to a bank
 */
export async function hasBankAccess(userId: string, bankId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_bank_access')
      .select('id')
      .eq('user_id', userId)
      .eq('bank_id', bankId)
      .maybeSingle();

    if (error) {
      return false;
    }

    return !!data;
  } catch (error) {
    return false;
  }
}

/**
 * Extract metadata from bank file
 */
export async function extractBankMetadata(zip: JSZip): Promise<BankMetadata | null> {
  try {
    const metadataFile = zip.file('metadata.json');
    if (!metadataFile) {
      return null;
    }

    const metadataText = await metadataFile.async('string');
    const parsed = JSON.parse(metadataText);
    return parsed;
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return null;
  }
}

/**
 * Add metadata to bank file
 */
export function addBankMetadata(zip: JSZip, metadata: BankMetadata): void {
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));
}

/**
 * Clear key cache (useful for logout)
 */
export function clearKeyCache(): void {
  keyCache.clear();
}

// Helpers
export function parseBankIdFromFileName(fileName: string): string | null {
  // find UUID in the filename
  const uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/;
  const match = fileName.match(uuidRegex);
  return match ? match[0] : null;
}

/**
 * List all bank IDs the user has access to
 * Uses localStorage cache for offline support
 */
export async function listAccessibleBankIds(userId: string): Promise<string[]> {
  // Check localStorage cache first (for offline support)
  const cached = getCachedAccessibleBanks(userId);
  
  try {
    const { data, error } = await supabase
      .from('user_bank_access')
      .select('bank_id')
      .eq('user_id', userId);
    
    if (error || !data) {
      // Network failed, use cache if available
      if (cached) {
        console.log('⚠️ Network failed, using cached accessible banks');
        return cached;
      }
      return [];
    }
    
    const bankIds = data.map((row: any) => row.bank_id as string);
    
    // Cache the results for offline use
    setCachedAccessibleBanks(userId, bankIds);
    
    return bankIds;
  } catch (error) {
    console.error('Error listing accessible banks:', error);
    // Network failed, use cache if available
    if (cached) {
      console.log('⚠️ Network failed, using cached accessible banks');
      return cached;
    }
    return [];
  }
}

/**
 * Refresh the user's accessible banks cache
 * Call this when user logs in or when app starts
 */
export async function refreshAccessibleBanksCache(userId: string): Promise<void> {
  try {

    
    // Fetch all accessible banks
    const { data: accessData, error: accessError } = await supabase
      .from('user_bank_access')
      .select('bank_id')
      .eq('user_id', userId);
    
    if (accessError || !accessData) {
      console.warn('Failed to fetch accessible banks:', accessError);
      return;
    }
    
    const bankIds = accessData.map((row: any) => row.bank_id as string);
    setCachedAccessibleBanks(userId, bankIds);
    
    // Fetch and cache derived keys for all accessible banks
    const keysToCache: Record<string, string> = {};
    for (const bankId of bankIds) {
      const { data: bankData, error: bankError } = await supabase
        .from('banks')
        .select('derived_key')
        .eq('id', bankId)
        .maybeSingle();
      
      if (!bankError && bankData?.derived_key) {
        keysToCache[bankId] = bankData.derived_key;
        // Also populate memory cache
        keyCache.set(`${userId}-${bankId}`, bankData.derived_key);
      }
    }
    
    if (Object.keys(keysToCache).length > 0) {
      setCachedBankKeys(userId, keysToCache);
    }
    

  } catch (error) {
    console.error('Error refreshing accessible banks cache:', error);
  }
}
