import express from 'express';
import dotenv from 'dotenv';
import { setupStaticServing } from './static-serve.js';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import type { Request, Response } from 'express';

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

app.post('/api/webhook/auth-event', async (req: Request, res: Response) => {
  try {
    if (!DISCORD_WEBHOOK_AUTH) return res.status(500).json({ error: 'Webhook not configured' });
    const { event, email, device } = req.body || {};
    if (!event || !email) return res.status(400).json({ error: 'Missing event or email' });

    const clientIp = parseClientIp(req) || 'unknown';
    const geo = clientIp !== 'unknown' ? await fetchGeo(clientIp) : null;
    const deviceInfo = device || {};

    const lines = [
      `**Auth Event:** ${String(event).toUpperCase()}`,
      `**Email:** ${email}`,
      `**IP:** ${clientIp}`,
      `**Device:** ${deviceInfo?.device || deviceInfo?.platform || deviceInfo?.ua || 'unknown'}`,
      deviceInfo?.timezone ? `**Time Zone:** ${deviceInfo.timezone}` : '',
      geo?.city || geo?.region || geo?.country ? `**Location:** ${[geo?.city, geo?.region, geo?.country].filter(Boolean).join(', ')}` : '',
      geo?.timezone ? `**Geo TZ:** ${geo.timezone}` : '',
      geo?.org ? `**Org:** ${geo.org}` : '',
    ].filter(Boolean);

    await postDiscordWebhook(DISCORD_WEBHOOK_AUTH, lines.join('\n'));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/export-bank', async (req: Request, res: Response) => {
  try {
    if (!DISCORD_WEBHOOK_EXPORT) return res.status(500).json({ error: 'Webhook not configured' });
    const { email, bankName, padNames } = req.body || {};
    if (!email || !bankName || !Array.isArray(padNames)) {
      return res.status(400).json({ error: 'Missing email, bankName, or padNames' });
    }

    const lines = [
      '**Bank Export:**',
      `**Email:** ${email}`,
      `**Bank:** ${bankName}`,
      `**Pad Count:** ${padNames.length}`,
      '**Pad List:** attached as file',
    ];
    const sanitizedBankName = String(bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
    const padListText = [
      `Bank: ${bankName}`,
      `Email: ${email}`,
      `Pad Count: ${padNames.length}`,
      '',
      ...((padNames as string[]).length ? (padNames as string[]).map((name: string) => `- ${name}`) : ['- (no pads)']),
    ].join('\n');
    await postDiscordWebhookWithTextFile(
      DISCORD_WEBHOOK_EXPORT,
      lines.join('\n'),
      `export_${sanitizedBankName}_pads.txt`,
      padListText
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Unknown error' });
  }
});

app.post('/api/webhook/import-bank', async (req: Request, res: Response) => {
  try {
    if (!DISCORD_WEBHOOK_IMPORT) return res.status(500).json({ error: 'Webhook not configured' });
    const { status, email, bankName, padNames, includePadList, errorMessage } = req.body || {};
    if (!status || !email || !bankName) {
      return res.status(400).json({ error: 'Missing status, email, or bankName' });
    }

    const normalizedStatus = String(status).toUpperCase();
    const shouldShowPads = !!includePadList && Array.isArray(padNames);
    const lines = [
      '**Bank Import:**',
      `**Status:** ${normalizedStatus}`,
      `**Email:** ${email}`,
      `**Bank:** ${bankName}`,
      normalizedStatus === 'FAILED' && errorMessage ? `**Failed Message:** ${errorMessage}` : '',
      shouldShowPads ? `**Pad Count:** ${(padNames as string[]).length}` : '',
      shouldShowPads ? '**Pad List:** attached as file' : '',
    ].filter(Boolean);
    if (shouldShowPads) {
      const sanitizedBankName = String(bankName).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40) || 'bank';
      const padListText = [
        `Bank: ${bankName}`,
        `Email: ${email}`,
        `Status: ${normalizedStatus}`,
        '',
        (padNames as string[]).length
          ? (padNames as string[]).map((name: string) => `- ${name}`).join('\n')
          : '- (no pads)',
      ].join('\n');
      await postDiscordWebhookWithTextFile(
        DISCORD_WEBHOOK_IMPORT,
        lines.join('\n'),
        `import_${sanitizedBankName}_pads.txt`,
        padListText
      );
    } else {
      await postDiscordWebhook(DISCORD_WEBHOOK_IMPORT, lines.join('\n'));
    }
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
