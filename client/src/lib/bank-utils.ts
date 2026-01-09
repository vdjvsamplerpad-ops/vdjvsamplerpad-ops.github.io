import JSZip from 'jszip';
import { supabase } from './supabase';
import { BankMetadata, AdminBank, UserBankAccess } from '@/components/sampler/types/sampler';

// Secret key for deriving passwords (in production, this should be in environment variables)
const SECRET_KEY = 'vdjv-sampler-secret-2024';

// Cache for derived keys to avoid repeated database calls
const keyCache = new Map<string, string>();

// Export keyCache for use in other modules
export { keyCache };

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
 * Get derived key for a bank from cache or database
 */
export async function getDerivedKey(bankId: string, userId: string): Promise<string | null> {
  // Check cache first
  const cacheKey = `${userId}-${bankId}`;
  if (keyCache.has(cacheKey)) {
    return keyCache.get(cacheKey)!;
  }

  try {
      // Check if user has access to this bank
    const { data: access, error } = await supabase
      .from('user_bank_access')
      .select('*')
      .eq('user_id', userId)
      .eq('bank_id', bankId)
      .single();

    if (error || !access) {
      return null;
    }

    // Get bank details to get derived_key
    const { data: bank, error: bankError } = await supabase
      .from('banks')
      .select('derived_key')
      .eq('id', bankId)
      .single();

    if (bankError || !bank) {
      return null;
    }

    // Cache the derived key
    keyCache.set(cacheKey, bank.derived_key);
    return bank.derived_key;
  } catch (error) {
    console.error('Error getting derived key:', error);
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
      .single();

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

export async function listAccessibleBankIds(userId: string): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('user_bank_access')
      .select('bank_id')
      .eq('user_id', userId);
    if (error || !data) return [];
    return data.map((row: any) => row.bank_id as string);
  } catch {
    return [];
  }
}
