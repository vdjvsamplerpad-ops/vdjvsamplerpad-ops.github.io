const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

export const asString = (value: unknown, maxLen = 500): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

export const asUuid = (value: unknown): string | null => {
  const text = asString(value, 80);
  if (!text) return null;
  return UUID_RE.test(text) ? text : null;
};

export const asNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

export const extractPadNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const normalized = asString(item, 140);
    if (normalized) names.push(normalized);
    if (names.length >= 5000) break;
  }
  return names;
};
