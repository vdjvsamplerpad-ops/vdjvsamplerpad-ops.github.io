import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asString } from "../_shared/validate.ts";

const parseIdFromPath = (pathname: string): string | null => {
  const parts = pathname.split("/").filter(Boolean);
  const usersIndex = parts.findIndex((p) => p === "users");
  if (usersIndex < 0) return null;
  const id = parts[usersIndex + 1];
  return id || null;
};

const parseActionFromPath = (pathname: string): string | null => {
  const parts = pathname.split("/").filter(Boolean);
  const usersIndex = parts.findIndex((p) => p === "users");
  if (usersIndex < 0) return null;
  return parts[usersIndex + 2] || null;
};

const requireAdmin = async (req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user) return { ok: false, response: json(401, { error: "Unauthorized" }) };
  const isAdmin = await isAdminUser(user.id);
  if (!isAdmin) return { ok: false, response: json(403, { error: "Forbidden" }) };
  return { ok: true, userId: user.id };
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.response;

    const url = new URL(req.url);
    const pathname = url.pathname;
    const admin = createServiceClient();

    if (req.method === "GET" && pathname.endsWith("/users")) {
      const q = String(url.searchParams.get("q") || "").toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const perPage = Math.max(1, Math.min(1000, Number(url.searchParams.get("perPage") || 100)));
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) return json(500, { error: error.message });

      const mapped = (data?.users || []).map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        banned_until: (u as any).banned_until || null,
        display_name: (u.user_metadata as any)?.display_name || u.email?.split("@")[0] || "User",
      }));

      const filtered = q
        ? mapped.filter((u) =>
            (u.email || "").toLowerCase().includes(q) ||
            (u.display_name || "").toLowerCase().includes(q) ||
            (u.id || "").toLowerCase().includes(q)
          )
        : mapped;

      return json(200, { users: filtered, page, perPage });
    }

    if (req.method === "GET" && pathname.endsWith("/active-sessions")) {
      const q = asString(url.searchParams.get("q"), 120)?.toLowerCase() || "";
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

      const { data: sessions, error: sessionsError } = await admin
        .from("v_active_sessions_now")
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(limit);
      if (sessionsError) return json(500, { error: sessionsError.message });

      const rows = Array.isArray(sessions) ? sessions : [];
      const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
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
              .join(" ")
              .toLowerCase();
            return text.includes(q);
          })
        : nonAdminRows;

      const uniqueActiveUsers = new Set(filtered.map((row: any) => row.user_id)).size;
      return json(200, {
        counts: { activeSessions: filtered.length, activeUsers: uniqueActiveUsers },
        sessions: filtered,
        total: filtered.length,
      });
    }

    if (req.method !== "POST") return json(405, { error: "Method not allowed" });
    const body = await req.json().catch(() => ({}));

    if (pathname.endsWith("/users/create")) {
      const email = String(body?.email || "").trim().toLowerCase();
      const password = String(body?.password || "");
      const displayNameInput = String(body?.displayName || "").trim();
      if (!email || !email.includes("@")) return badRequest("Valid email is required");
      if (!password || password.length < 6) return badRequest("Password must be at least 6 characters");

      const displayName = displayNameInput || email.split("@")[0] || "User";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
      } as any);
      if (createErr || !created?.user) {
        return json(500, { error: createErr?.message || "Failed to create user" });
      }

      const userId = created.user.id;
      const { error: profileErr } = await admin
        .from("profiles")
        .upsert({ id: userId, display_name: displayName, role: "user" }, { onConflict: "id" });
      if (profileErr) return json(500, { error: `User created, profile setup failed: ${profileErr.message}` });

      return json(200, {
        ok: true,
        user: { id: userId, email: created.user.email, display_name: displayName },
      });
    }

    const userId = parseIdFromPath(pathname);
    const action = parseActionFromPath(pathname);
    if (!userId || !action) return json(404, { error: "Unknown admin route" });

    if (action === "delete") {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "ban") {
      const hours = Number(body?.hours || 24);
      const banEndTime = new Date();
      banEndTime.setHours(banEndTime.getHours() + hours);
      const { error } = await admin.auth.admin.updateUserById(userId, { banned_until: banEndTime.toISOString() } as any);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "unban") {
      const { error } = await admin.auth.admin.updateUserById(userId, { banned_until: null } as any);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if (action === "reset-password") {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      if (error || !data?.user) return json(404, { error: error?.message || "User not found" });
      const email = data.user.email;
      if (!email) return badRequest("User has no email");

      const supabaseUrl = resolveSupabaseUrl();
      const supabaseAnonKey = resolveSupabaseAnonKey();
      if (!supabaseUrl || !supabaseAnonKey) return json(500, { error: "Missing Supabase environment variables" });

      const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      const { error: resetErr } = await anon.auth.resetPasswordForEmail(email, {
        redirectTo: `${Deno.env.get("PUBLIC_SITE_URL") || "http://localhost:3000"}`,
      });
      if (resetErr) return json(500, { error: resetErr.message });
      return json(200, { ok: true });
    }

    return json(404, { error: "Unknown admin route" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: message });
  }
});
const resolveSupabaseUrl = (): string =>
  Deno.env.get("APP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";

const resolveSupabaseAnonKey = (): string =>
  Deno.env.get("APP_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

