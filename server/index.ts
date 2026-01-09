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

console.log('Environment variables loaded:');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'SET' : 'NOT SET');
console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET');
console.log('SUPABASE_ANON_KEY:', SUPABASE_ANON_KEY ? 'SET' : 'NOT SET');

const adminSupabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

// Body parsing middleware - MUST be before routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
