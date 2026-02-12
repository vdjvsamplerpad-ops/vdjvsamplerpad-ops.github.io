import express from 'express';
import dotenv from 'dotenv';
import { setupStaticServing } from './static-serve.js';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import type { Request } from 'express';

// Load .env from the project root (one level up from server directory)
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
// Admin Supabase client (service role) for secure admin operations
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const DISCORD_WEBHOOK_AUTH = process.env.DISCORD_WEBHOOK_AUTH as string;
const DISCORD_WEBHOOK_EXPORT = process.env.DISCORD_WEBHOOK_EXPORT as string;
const DISCORD_WEBHOOK_IMPORT = process.env.DISCORD_WEBHOOK_IMPORT as string;

console.log('Environment variables loaded:');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');
console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET');
console.log('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'SET' : 'NOT SET');
console.log('DISCORD_WEBHOOK_AUTH:', DISCORD_WEBHOOK_AUTH ? 'SET' : 'NOT SET');
console.log('DISCORD_WEBHOOK_EXPORT:', DISCORD_WEBHOOK_EXPORT ? 'SET' : 'NOT SET');
console.log('DISCORD_WEBHOOK_IMPORT:', DISCORD_WEBHOOK_IMPORT ? 'SET' : 'NOT SET');

const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Body parsing middleware - MUST be before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const parseClientIp = (req: Request): string | null => {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.socket.remoteAddress || '');
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim() || '';
  const normalized = first.replace('::ffff:', '');
  return normalized || null;
};

const isPrivateIp = (ip: string): boolean => {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.3')
  );
};

const fetchGeo = async (ip: string): Promise<Record<string, string> | null> => {
  try {
    if (!ip || isPrivateIp(ip)) return null;
    const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { method: 'GET' });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.error) return null;
    return {
      city: data?.city || '',
      region: data?.region || '',
      country: data?.country_name || data?.country || '',
      timezone: data?.timezone || '',
      org: data?.org || data?.org_name || '',
    };
  } catch {
    return null;
  }
};

const postDiscordWebhook = async (url: string, content: string) => {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

const postDiscordWebhookWithTextFile = async (
  url: string,
  content: string,
  fileName: string,
  fileText: string
) => {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content }));
  form.append('file', new Blob([fileText], { type: 'text/plain' }), fileName);

  const resp = await fetch(url, {
    method: 'POST',
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

type ActivityEventType =
  | 'auth.login'
  | 'auth.signup'
  | 'auth.signout'
  | 'bank.export'
  | 'bank.import';

type ActivityStatus = 'success' | 'failed';

type DevicePayload = {
  fingerprint?: string | null;
  name?: string | null;
  model?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  raw?: Record<string, unknown> | null;
};

type ActivityEventPayload = {
  requestId: string;
  eventType: ActivityEventType;
  status: ActivityStatus;
  userId?: string | null;
  email?: string | null;
  sessionKey?: string | null;
  device?: DevicePayload | null;
  bankId?: string | null;
  bankName?: string | null;
  padCount?: number | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown> | null;
};

const ACTIVITY_EVENT_TYPES: ActivityEventType[] = [
  'auth.login',
  'auth.signup',
  'auth.signout',
  'bank.export',
  'bank.import',
];
const ACTIVITY_STATUS_VALUES: ActivityStatus[] = ['success', 'failed'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const asString = (value: unknown, maxLen = 500): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const asUuid = (value: unknown): string | null => {
  const s = asString(value, 80);
  if (!s) return null;
  return UUID_RE.test(s) ? s : null;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const isActivityEventType = (value: unknown): value is ActivityEventType =>
  typeof value === 'string' && ACTIVITY_EVENT_TYPES.includes(value as ActivityEventType);

const isActivityStatus = (value: unknown): value is ActivityStatus =>
  typeof value === 'string' && ACTIVITY_STATUS_VALUES.includes(value as ActivityStatus);

const normalizeDevicePayload = (value: unknown): DevicePayload => {
  const raw = asObject(value);
  return {
    fingerprint: asString(raw.fingerprint, 256),
    name: asString(raw.name, 200),
    model: asString(raw.model, 200),
    platform: asString(raw.platform, 120),
    browser: asString(raw.browser, 120),
    os: asString(raw.os, 120),
    raw: asObject(raw.raw),
  };
};

const extractPadNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const normalized = asString(item, 140);
    if (normalized) names.push(normalized);
    if (names.length >= 5000) break;
  }
  return names;
};

const mapDeviceForDisplay = (device: DevicePayload): string => {
  return (
    device.name ||
    device.model ||
    [device.platform, device.os, device.browser].filter(Boolean).join(' / ') ||
    'unknown'
  );
};

const writeActivityLog = async (payload: ActivityEventPayload) => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const metaForStorage = asObject(payload.meta);
  const { error } = await adminSupabase
    .from('activity_logs')
    .insert({
      request_id: payload.requestId,
      event_type: payload.eventType,
      status: payload.status,
      user_id: payload.userId || null,
      email: payload.email || null,
      session_key: payload.sessionKey || null,
      device_fingerprint: payload.device?.fingerprint || null,
      device_name: payload.device?.name || null,
      device_model: payload.device?.model || null,
      platform: payload.device?.platform || null,
      browser: payload.device?.browser || null,
      os: payload.device?.os || null,
      bank_id: payload.bankId || null,
      bank_name: payload.bankName || null,
      pad_count: payload.padCount ?? null,
      error_message: payload.errorMessage || null,
      meta: metaForStorage,
    })
    .select('id')
    .single();

  if (!error) return { deduped: false };
  if (error.code === '23505' || /duplicate key/i.test(error.message || '')) {
    return { deduped: true };
  }
  throw new Error(error.message);
};

const upsertActiveSession = async (payload: {
  sessionKey: string;
  userId: string;
  email?: string | null;
  device: DevicePayload;
  ip?: string | null;
  lastEvent?: string | null;
  meta?: Record<string, unknown> | null;
}) => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const rpcPayload = {
    p_session_key: payload.sessionKey,
    p_user_id: payload.userId,
    p_email: payload.email || null,
    p_device_fingerprint: payload.device.fingerprint || 'unknown',
    p_device_name: payload.device.name || null,
    p_device_model: payload.device.model || null,
    p_platform: payload.device.platform || null,
    p_browser: payload.device.browser || null,
    p_os: payload.device.os || null,
    p_ip: payload.ip || null,
    p_last_event: payload.lastEvent || null,
    p_meta: asObject(payload.meta),
  };

  const { error } = await adminSupabase.rpc('upsert_active_session', rpcPayload);
  if (!error) return;

  const fallback = await adminSupabase
    .from('active_sessions')
    .upsert(
      {
        session_key: payload.sessionKey,
        user_id: payload.userId,
        email: payload.email || null,
        device_fingerprint: payload.device.fingerprint || 'unknown',
        device_name: payload.device.name || null,
        device_model: payload.device.model || null,
        platform: payload.device.platform || null,
        browser: payload.device.browser || null,
        os: payload.device.os || null,
        ip: payload.ip || null,
        last_seen_at: new Date().toISOString(),
        is_online: true,
        last_event: payload.lastEvent || null,
        meta: asObject(payload.meta),
      },
      { onConflict: 'session_key' }
    );

  if (fallback.error) {
    throw new Error(fallback.error.message || error.message);
  }
};

const markSessionOffline = async (sessionKey: string, lastEvent = 'auth.signout') => {
  if (!adminSupabase) throw new Error('Admin client not configured');

  const { error } = await adminSupabase.rpc('mark_session_offline', {
    p_session_key: sessionKey,
    p_last_event: lastEvent,
  });
  if (!error) return;

  const fallback = await adminSupabase
    .from('active_sessions')
    .update({
      is_online: false,
      last_seen_at: new Date().toISOString(),
      last_event: lastEvent,
    })
    .eq('session_key', sessionKey);

  if (fallback.error) {
    throw new Error(fallback.error.message || error.message);
  }
};

const sendDiscordAuthEvent = async (
  payload: {
    eventType: ActivityEventType;
    email: string;
    device: DevicePayload;
    status?: ActivityStatus;
    errorMessage?: string | null;
  },
  req: Request
) => {
  if (!DISCORD_WEBHOOK_AUTH) return;
  const clientIp = parseClientIp(req) || 'unknown';
  const geo = clientIp !== 'unknown' ? await fetchGeo(clientIp) : null;
  const eventName = payload.eventType.replace('auth.', '').toUpperCase();
  const lines = [
    `**Auth Event:** ${eventName}`,
    payload.status ? `**Status:** ${payload.status.toUpperCase()}` : '',
    `**Email:** ${payload.email}`,
    `**IP:** ${clientIp}`,
    `**Device:** ${mapDeviceForDisplay(payload.device)}`,
    payload.device?.model ? `**Model:** ${payload.device.model}` : '',
    payload.device?.platform ? `**Platform:** ${payload.device.platform}` : '',
    payload.device?.browser ? `**Browser:** ${payload.device.browser}` : '',
    payload.device?.os ? `**OS:** ${payload.device.os}` : '',
    payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    geo?.city || geo?.region || geo?.country
      ? `**Location:** ${[geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ')}`
      : '',
    geo?.timezone ? `**Geo TZ:** ${geo.timezone}` : '',
    geo?.org ? `**Org:** ${geo.org}` : '',
  ].filter(Boolean);
  await postDiscordWebhook(DISCORD_WEBHOOK_AUTH, lines.join('\n'));
};

const sendDiscordExportEvent = async (payload: {
  status?: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  errorMessage?: string | null;
}) => {
  if (!DISCORD_WEBHOOK_EXPORT) return;
  const lines = [
    '**Bank Export:**',
    payload.status ? `**Status:** ${payload.status.toUpperCase()}` : '',
    `**Email:** ${payload.email}`,
    `**Bank:** ${payload.bankName}`,
    `**Pad Count:** ${payload.padNames.length}`,
    payload.status === 'failed' && payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    '**Pad List:** attached as file',
  ];
  const sanitizedBankName =
    String(payload.bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
  const padListText = [
    `Bank: ${payload.bankName}`,
    `Email: ${payload.email}`,
    `Pad Count: ${payload.padNames.length}`,
    '',
    ...(payload.padNames.length ? payload.padNames.map((name) => `- ${name}`) : ['- (no pads)']),
  ].join('\n');
  await postDiscordWebhookWithTextFile(
    DISCORD_WEBHOOK_EXPORT,
    lines.join('\n'),
    `export_${sanitizedBankName}_pads.txt`,
    padListText
  );
};

const sendDiscordImportEvent = async (payload: {
  status: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  includePadList: boolean;
  errorMessage?: string | null;
}) => {
  if (!DISCORD_WEBHOOK_IMPORT) return;
  const normalizedStatus = payload.status.toUpperCase();
  const shouldShowPads = payload.includePadList && payload.padNames.length > 0;
  const lines = [
    '**Bank Import:**',
    `**Status:** ${normalizedStatus}`,
    `**Email:** ${payload.email}`,
    `**Bank:** ${payload.bankName}`,
    normalizedStatus === 'FAILED' && payload.errorMessage ? `**Failed Message:** ${payload.errorMessage}` : '',
    shouldShowPads ? `**Pad Count:** ${payload.padNames.length}` : '',
    shouldShowPads ? '**Pad List:** attached as file' : '',
  ].filter(Boolean);

  if (!shouldShowPads) {
    await postDiscordWebhook(DISCORD_WEBHOOK_IMPORT, lines.join('\n'));
    return;
  }

  const sanitizedBankName =
    String(payload.bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
  const padListText = [
    `Bank: ${payload.bankName}`,
    `Email: ${payload.email}`,
    `Status: ${normalizedStatus}`,
    '',
    payload.padNames.map((name) => `- ${name}`).join('\n'),
  ].join('\n');
  await postDiscordWebhookWithTextFile(
    DISCORD_WEBHOOK_IMPORT,
    lines.join('\n'),
    `import_${sanitizedBankName}_pads.txt`,
    padListText
  );
};

const getProfileRole = async (userId: string): Promise<'admin' | 'user' | null> => {
  if (!adminSupabase) return null;
  try {
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data?.role) return null;
    return data.role === 'admin' ? 'admin' : 'user';
  } catch {
    return null;
  }
};

const isAdminUser = async (userId: string | null): Promise<boolean> => {
  if (!userId) return false;
  const role = await getProfileRole(userId);
  return role === 'admin';
};

// Admin endpoint: List users (basic pagination & search)
app.get('/api/admin/users', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const q = String(req.query.q || '').toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const perPage = Math.max(1, Math.min(100, Number(req.query.perPage || 100)));

    const { data, error } = await adminSupabase.auth.admin.listUsers({ page, perPage });
    if (error) return res.status(500).json({ error: error.message });

    const mapped = (data?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      banned_until: (u as any).banned_until || null,
      display_name: (u.user_metadata as any)?.display_name || u.email?.split('@')[0] || 'User',
    }));

    const filtered = q
      ? mapped.filter((u) =>
          (u.email || '').toLowerCase().includes(q) ||
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.id || '').toLowerCase().includes(q)
        )
      : mapped;

    res.json({ users: filtered, page, perPage });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Create user (auto-confirmed)
app.post('/api/admin/users/create', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const displayNameInput = String(req.body?.displayName || '').trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const displayName = displayNameInput || email.split('@')[0] || 'User';
    const { data: created, error: createErr } = await adminSupabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    } as any);
    if (createErr || !created?.user) {
      return res.status(500).json({ error: createErr?.message || 'Failed to create user' });
    }

    const userId = created.user.id;
    const { error: profileErr } = await adminSupabase
      .from('profiles')
      .upsert(
        { id: userId, display_name: displayName, role: 'user' },
        { onConflict: 'id' }
      );
    if (profileErr) {
      return res.status(500).json({ error: `User created, profile setup failed: ${profileErr.message}` });
    }

    return res.json({
      ok: true,
      user: {
        id: userId,
        email: created.user.email,
        display_name: displayName,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Delete user
app.post('/api/admin/users/:id/delete', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { error } = await adminSupabase.auth.admin.deleteUser(userId);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Ban user (disable)
app.post('/api/admin/users/:id/ban', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { hours = 24 } = req.body; // Default to 24 hours if not specified
    
    // Calculate ban end time
    const banEndTime = new Date();
    banEndTime.setHours(banEndTime.getHours() + hours);
    
    const { error } = await adminSupabase.auth.admin.updateUserById(userId, { 
      banned_until: banEndTime.toISOString() 
    } as any);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Unban user
app.post('/api/admin/users/:id/unban', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { error } = await adminSupabase.auth.admin.updateUserById(userId, { banned_until: null } as any);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Admin: Send password reset (email)
app.post('/api/admin/users/:id/reset-password', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    const userId = req.params.id;
    const { data, error } = await adminSupabase.auth.admin.getUserById(userId);
    if (error || !data?.user) return res.status(404).json({ error: error?.message || 'User not found' });
    const email = data.user.email;
    if (!email) return res.status(400).json({ error: 'User has no email' });

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: resetErr } = await anon.auth.resetPasswordForEmail(email, { redirectTo: `${process.env.PUBLIC_SITE_URL || 'http://localhost:3000'}` });
    if (resetErr) return res.status(500).json({ error: resetErr.message });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/event', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');

    const body = req.body || {};
    const requestId = asUuid(body.requestId);
    const eventType = body.eventType;
    const status = body.status;
    if (!requestId) return res.status(400).json({ error: 'Missing or invalid requestId' });
    if (!isActivityEventType(eventType)) return res.status(400).json({ error: 'Invalid eventType' });
    if (!isActivityStatus(status)) return res.status(400).json({ error: 'Invalid status' });

    const userId = asUuid(body.userId);
    const sessionKey = asUuid(body.sessionKey);
    const device = normalizeDevicePayload(body.device);
    const bankName = asString(body.bankName, 200);
    const bankId = asString(body.bankId, 200);
    const errorMessage = asString(body.errorMessage, 2000);
    const meta = asObject(body.meta);
    const padNames = extractPadNames(body.padNames);
    const explicitPadCount = asNumber(body.padCount);
    const padCount = explicitPadCount ?? (padNames.length > 0 ? padNames.length : null);
    const email = asString(body.email, 320);
    const ip = parseClientIp(req);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }

    const result = await writeActivityLog({
      requestId,
      eventType,
      status,
      userId,
      email,
      sessionKey,
      device,
      bankId,
      bankName,
      padCount,
      errorMessage,
      meta: {
        ...meta,
        padNamesCount: padNames.length,
        includePadList: Boolean(meta.includePadList),
      },
    });

    if (result.deduped) {
      return res.json({ ok: true, deduped: true });
    }

    if (status === 'success') {
      if (eventType === 'auth.signout') {
        if (sessionKey) await markSessionOffline(sessionKey, 'auth.signout');
      } else if (sessionKey && userId) {
        await upsertActiveSession({
          sessionKey,
          userId,
          email,
          device,
          ip,
          lastEvent: eventType,
          meta,
        });
      }
    }

    let discordError: string | null = null;
    try {
      if (eventType.startsWith('auth.')) {
        await sendDiscordAuthEvent({ eventType, email: email || 'unknown', device, status, errorMessage }, req);
      } else if (eventType === 'bank.export') {
        await sendDiscordExportEvent({
          status,
          email: email || 'unknown',
          bankName: bankName || 'unknown',
          padNames,
          errorMessage,
        });
      } else if (eventType === 'bank.import') {
        await sendDiscordImportEvent({
          status,
          email: email || 'unknown',
          bankName: bankName || 'unknown',
          padNames,
          includePadList: Boolean(meta.includePadList),
          errorMessage,
        });
      }
    } catch (err: any) {
      discordError = err?.message || 'Discord fanout failed';
      console.warn('Discord fanout warning:', discordError);
    }

    res.json({ ok: true, discordError });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/heartbeat', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const sessionKey = asUuid(body.sessionKey);
    const userId = asUuid(body.userId);
    if (!sessionKey) return res.status(400).json({ error: 'Missing or invalid sessionKey' });
    if (!userId) return res.status(400).json({ error: 'Missing or invalid userId' });

    const device = normalizeDevicePayload(body.device);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }
    await upsertActiveSession({
      sessionKey,
      userId,
      email: asString(body.email, 320),
      device,
      ip: parseClientIp(req),
      lastEvent: asString(body.lastEvent, 60) || 'heartbeat',
      meta: asObject(body.meta),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/activity/signout', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const requestId = asUuid(body.requestId);
    const sessionKey = asUuid(body.sessionKey);
    const userId = asUuid(body.userId);
    const status = isActivityStatus(body.status) ? body.status : 'success';
    if (!requestId) return res.status(400).json({ error: 'Missing or invalid requestId' });
    if (!sessionKey) return res.status(400).json({ error: 'Missing or invalid sessionKey' });

    const email = asString(body.email, 320);
    const device = normalizeDevicePayload(body.device);
    const errorMessage = asString(body.errorMessage, 2000);
    if (await isAdminUser(userId)) {
      return res.json({ ok: true, skippedAdmin: true });
    }

    const result = await writeActivityLog({
      requestId,
      eventType: 'auth.signout',
      status,
      userId,
      email,
      sessionKey,
      device,
      errorMessage,
      meta: asObject(body.meta),
    });

    if (!result.deduped && status === 'success') {
      await markSessionOffline(sessionKey, 'auth.signout');
    }

    let discordError: string | null = null;
    try {
      if (!result.deduped) {
        await sendDiscordAuthEvent(
          {
            eventType: 'auth.signout',
            email: email || 'unknown',
            device,
            status,
            errorMessage,
          },
          req
        );
      }
    } catch (err: any) {
      discordError = err?.message || 'Discord fanout failed';
      console.warn('Discord fanout warning:', discordError);
    }

    res.json({ ok: true, deduped: result.deduped, discordError });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.get('/api/admin/active-sessions', async (req: any, res: any) => {
  try {
    if (!adminSupabase) return res.status(500).json({ error: 'Admin client not configured' });
    res.set('Cache-Control', 'no-store');
    const q = asString(req.query.q, 120)?.toLowerCase() || '';
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));

    const { data: sessions, error: sessionsError } = await adminSupabase
      .from('v_active_sessions_now')
      .select('*')
      .order('last_seen_at', { ascending: false })
      .limit(limit);
    if (sessionsError) return res.status(500).json({ error: sessionsError.message });

    const rows = Array.isArray(sessions) ? sessions : [];
    const { data: admins } = await adminSupabase.from('profiles').select('id').eq('role', 'admin');
    const adminIds = new Set((admins || []).map((a: any) => a.id));
    const nonAdminRows = rows.filter((row: any) => !adminIds.has(row?.user_id));
    const filtered = q
      ? nonAdminRows.filter((row: any) => {
          const text = [
            row?.email,
            row?.device_name,
            row?.device_model,
            row?.platform,
            row?.browser,
            row?.os,
            row?.session_key,
            row?.user_id,
            row?.device_fingerprint,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return text.includes(q);
        })
      : nonAdminRows;

    const uniqueActiveUsers = new Set(filtered.map((row: any) => row.user_id)).size;

    res.json({
      counts: {
        activeSessions: filtered.length,
        activeUsers: uniqueActiveUsers,
      },
      sessions: filtered,
      total: filtered.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// Legacy webhook endpoints retained for backwards compatibility
app.post('/api/webhook/auth-event', async (req: any, res: any) => {
  try {
    const { event, email, device } = req.body || {};
    if (!event || !email) return res.status(400).json({ error: 'Missing event or email' });
    const rawEvent = String(event).toLowerCase();
    const mapped: ActivityEventType =
      rawEvent === 'signup' ? 'auth.signup' : rawEvent === 'signout' ? 'auth.signout' : 'auth.login';
    await sendDiscordAuthEvent(
      {
        eventType: mapped,
        email: String(email),
        device: normalizeDevicePayload({
          fingerprint: asString(device?.fingerprint, 256),
          name: asString(device?.device || device?.platform || device?.ua, 200),
          model: asString(device?.model, 200),
          platform: asString(device?.platform, 120),
          browser: asString(device?.browser, 120),
          os: asString(device?.os, 120),
          raw: asObject(device),
        }),
      },
      req
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/export-bank', async (req: any, res: any) => {
  try {
    const { email, bankName, padNames } = req.body || {};
    if (!email || !bankName || !Array.isArray(padNames)) {
      return res.status(400).json({ error: 'Missing email, bankName, or padNames' });
    }
    await sendDiscordExportEvent({
      email: String(email),
      bankName: String(bankName),
      padNames: extractPadNames(padNames),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/import-bank', async (req: any, res: any) => {
  try {
    const { status, email, bankName, padNames, includePadList, errorMessage } = req.body || {};
    if (!status || !email || !bankName) {
      return res.status(400).json({ error: 'Missing status, email, or bankName' });
    }

    const normalizedStatus: ActivityStatus =
      String(status).toLowerCase() === 'failed' ? 'failed' : 'success';
    await sendDiscordImportEvent({
      status: normalizedStatus,
      email: String(email),
      bankName: String(bankName),
      padNames: extractPadNames(padNames),
      includePadList: Boolean(includePadList),
      errorMessage: asString(errorMessage, 2000),
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

// example endpoint
// app.get('/api/hello', (req: express.Request, res: express.Response) => {
//   res.json({ message: 'Hello World!' });
// });

// Export a function to start the server
export async function startServer(port) {
  try {
    if (process.env.NODE_ENV === 'production') {
      setupStaticServing(app);
    }
    app.listen(port, () => {
      console.log(`API Server running on port ${port}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Start the server directly if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting server...');
  startServer(process.env.PORT || 3001);
}
