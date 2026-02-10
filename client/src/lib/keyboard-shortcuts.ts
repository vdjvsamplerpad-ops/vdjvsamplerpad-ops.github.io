export const RESERVED_SHORTCUT_KEYS = [
  'Space',
  'M',
  'Z',
  'X',
  'B',
  '[',
  ']',
  'N',
  'ArrowDown',
  'ArrowUp',
  '+',
  '-',
  'V',
  '`',
  'C'
] as const;

const RESERVED_SET = new Set(RESERVED_SHORTCUT_KEYS);

export type ReservedShortcutKey = (typeof RESERVED_SHORTCUT_KEYS)[number];

export function normalizeShortcutKey(
  rawKey: string,
  modifiers?: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    code?: string;
  }
): string | null {
  if (!rawKey) return null;

  const code = modifiers?.code;
  let baseKey = rawKey;
  if (code?.startsWith('Digit') && code.length === 6) {
    baseKey = code.replace('Digit', '');
  } else if (code?.startsWith('Key') && code.length === 4) {
    baseKey = code.replace('Key', '').toUpperCase();
  } else if (code === 'Semicolon') {
    baseKey = ';';
  } else if (code === 'Comma') {
    baseKey = ',';
  } else if (code === 'Period') {
    baseKey = '.';
  } else if (rawKey === ' ' || rawKey === 'Spacebar') baseKey = 'Space';
  else if (rawKey.startsWith('Arrow')) baseKey = rawKey;
  else if (rawKey.startsWith('Numpad')) baseKey = rawKey;
  else if (code?.startsWith('Numpad') && rawKey.length === 1 && /[0-9]/.test(rawKey)) {
    baseKey = `Numpad${rawKey}`;
  } else if (rawKey.length === 1) baseKey = rawKey.toUpperCase();
  else return null;

  const parts: string[] = [];
  if (modifiers?.shiftKey) parts.push('Shift');
  if (modifiers?.ctrlKey) parts.push('Ctrl');
  if (modifiers?.altKey) parts.push('Alt');
  if (modifiers?.metaKey) parts.push('Meta');
  parts.push(baseKey);

  return parts.join('+');
}

export function normalizeStoredShortcutKey(key?: string | null): string | null {
  if (!key) return null;
  if (!key.includes('+')) {
    return normalizeShortcutKey(key) || null;
  }
  const parts = key.split('+').map((part) => part.trim()).filter(Boolean);
  let baseKey = '';
  let shiftKey = false;
  let ctrlKey = false;
  let altKey = false;
  let metaKey = false;
  parts.forEach((part) => {
    const lower = part.toLowerCase();
    if (lower === 'shift') shiftKey = true;
    else if (lower === 'ctrl' || lower === 'control') ctrlKey = true;
    else if (lower === 'alt' || lower === 'option') altKey = true;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command' || lower === 'win') metaKey = true;
    else baseKey = part;
  });
  if (!baseKey) return null;
  return normalizeShortcutKey(baseKey, { shiftKey, ctrlKey, altKey, metaKey }) || null;
}

export function getShortcutBaseKey(key: string): string {
  const parts = key.split('+');
  return parts[parts.length - 1] || key;
}

export function hasShortcutModifiers(key: string): boolean {
  return key.includes('+');
}

export function isReservedShortcutKey(key: string): key is ReservedShortcutKey {
  const baseKey = getShortcutBaseKey(key);
  return RESERVED_SET.has(baseKey as ReservedShortcutKey);
}

export function isReservedShortcutCombo(key: string): boolean {
  return isReservedShortcutKey(key) && !hasShortcutModifiers(key);
}
