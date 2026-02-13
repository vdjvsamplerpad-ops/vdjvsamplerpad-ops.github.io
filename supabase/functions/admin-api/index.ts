import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import { createServiceClient, getUserFromAuthHeader, isAdminUser } from "../_shared/supabase.ts";
import { asString, asUuid } from "../_shared/validate.ts";

type SortDirection = "asc" | "desc";

type AdminRoute = {
  section: string;
  id: string | null;
  action: string | null;
};

const resolveSupabaseUrl = (): string =>
  Deno.env.get("APP_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";

const resolveSupabaseAnonKey = (): string =>
  Deno.env.get("APP_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";

const ok = (data: Record<string, unknown>, status = 200) =>
  json(status, { ok: true, data, ...data });

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  json(status, { ok: false, error, ...(extra || {}) });

const normalizeSortDir = (value: string | null): SortDirection => {
  return String(value || "").toLowerCase() === "asc" ? "asc" : "desc";
};

const normalizeHexColor = (value: unknown): string | null => {
  const color = asString(value, 16);
  if (!color) return null;
  const normalized = color.startsWith("#") ? color : `#${color}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return normalized.toLowerCase();
};

const compareNullableText = (a: string | null | undefined, b: string | null | undefined) => {
  return String(a || "").localeCompare(String(b || ""), undefined, { sensitivity: "base" });
};

const compareNullableDate = (a: string | null | undefined, b: string | null | undefined) => {
  const left = a ? new Date(a).getTime() : 0;
  const right = b ? new Date(b).getTime() : 0;
  if (Number.isNaN(left) && Number.isNaN(right)) return 0;
  if (Number.isNaN(left)) return -1;
  if (Number.isNaN(right)) return 1;
  return left - right;
};

const sortRows = <T,>(
  rows: T[],
  sortBy: string,
  sortDir: SortDirection,
  comparators: Record<string, (a: T, b: T) => number>,
): T[] => {
  const compare = comparators[sortBy];
  if (!compare) return rows;
  const sorted = [...rows].sort(compare);
  return sortDir === "asc" ? sorted : sorted.reverse();
};

const parseRoute = (pathname: string): AdminRoute => {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => part === "admin-api");
  if (index < 0) return { section: "", id: null, action: null };

  const section = parts[index + 1] || "";
  const id = parts[index + 2] || null;
  const action = parts[index + 3] || null;
  return { section, id, action };
};

const parseUuidList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const parsed = asUuid(item);
    if (parsed) unique.add(parsed);
    if (unique.size >= 2000) break;
  }
  return Array.from(unique);
};

const requireAdmin = async (req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> => {
  const authHeader = req.headers.get("Authorization");
  const user = await getUserFromAuthHeader(authHeader);
  if (!user) return { ok: false, response: fail(401, "Unauthorized") };
  const isAdmin = await isAdminUser(user.id);
  if (!isAdmin) return { ok: false, response: fail(403, "Forbidden") };
  return { ok: true, userId: user.id };
};

const listUsers = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.max(1, Math.min(1000, Number(url.searchParams.get("perPage") || 100)));
  const includeAdmins = String(url.searchParams.get("includeAdmins") || "false").toLowerCase() === "true";
  const sortBy = String(url.searchParams.get("sortBy") || "created_at");
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));

  const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
  if (error) return fail(500, error.message);

  const authUsers = data?.users || [];
  const userIds = authUsers.map((user) => user.id);
  const { data: profileRows, error: profileError } = userIds.length
    ? await admin
        .from("profiles")
        .select("id, role, display_name")
        .in("id", userIds)
    : { data: [], error: null };
  if (profileError) return fail(500, profileError.message);
  const profileMap = new Map((profileRows || []).map((row: any) => [row.id, row]));

  const mapped = authUsers.map((user: any) => {
    const profile = profileMap.get(user.id);
    const profileDisplayName = asString(profile?.display_name, 120);
    const metadataDisplayName = asString(user?.user_metadata?.display_name, 120);
    const displayName = profileDisplayName || metadataDisplayName || user.email?.split("@")[0] || "User";
    const role = profile?.role === "admin" ? "admin" : "user";
    const bannedUntil = (user as any).banned_until || null;
    const isBanned = Boolean(bannedUntil && new Date(bannedUntil).getTime() > Date.now());

    return {
      id: user.id,
      email: user.email || null,
      role,
      display_name: displayName,
      created_at: user.created_at || null,
      last_sign_in_at: user.last_sign_in_at || null,
      banned_until: bannedUntil,
      is_banned: isBanned,
    };
  });

  const visible = includeAdmins ? mapped : mapped.filter((row) => row.role !== "admin");
  const filtered = q
    ? visible.filter((row) =>
        [row.id, row.email, row.display_name, row.role].filter(Boolean).join(" ").toLowerCase().includes(q)
      )
    : visible;

  const sorted = sortRows(filtered, sortBy, sortDir, {
    display_name: (a, b) => compareNullableText(a.display_name, b.display_name),
    email: (a, b) => compareNullableText(a.email, b.email),
    created_at: (a, b) => compareNullableDate(a.created_at, b.created_at),
    last_sign_in_at: (a, b) => compareNullableDate(a.last_sign_in_at, b.last_sign_in_at),
    ban_status: (a, b) => Number(a.is_banned) - Number(b.is_banned),
  });

  return ok({
    users: sorted,
    page,
    perPage,
    total: sorted.length,
    sortBy,
    sortDir,
    includeAdmins,
  });
};

const listActiveSessions = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = asString(url.searchParams.get("q"), 120)?.toLowerCase() || "";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit") || 200)));

  const { data: sessions, error: sessionsError } = await admin
    .from("v_active_sessions_now")
    .select("*")
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (sessionsError) return fail(500, sessionsError.message);

  const rows = Array.isArray(sessions) ? sessions : [];
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  const adminIds = new Set((admins || []).map((a: any) => a.id));
  const nonAdminRows = rows.filter((row: any) => !adminIds.has(row?.user_id));
  const filtered = q
    ? nonAdminRows.filter((row: any) => {
        const text = [
          row?.email,
          row?.device_name,
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
  return ok({
    counts: { activeSessions: filtered.length, activeUsers: uniqueActiveUsers },
    sessions: filtered,
    total: filtered.length,
  });
};

const createUser = async (body: any, admin: ReturnType<typeof createServiceClient>) => {
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
    return fail(500, createErr?.message || "Failed to create user");
  }

  const userId = created.user.id;
  const { error: profileErr } = await admin
    .from("profiles")
    .upsert({ id: userId, display_name: displayName, role: "user" }, { onConflict: "id" });
  if (profileErr) return fail(500, `User created, profile setup failed: ${profileErr.message}`);

  return ok(
    {
      user: { id: userId, email: created.user.email, display_name: displayName, role: "user" },
    },
    201,
  );
};

const updateUserProfile = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const displayName = asString(body?.displayName, 120);
  if (!displayName) return badRequest("displayName is required");

  const { data: existingUser, error: existingUserError } = await admin.auth.admin.getUserById(userId);
  if (existingUserError || !existingUser?.user) {
    return fail(404, existingUserError?.message || "User not found");
  }

  const currentMetadata = ((existingUser.user as any).user_metadata || {}) as Record<string, unknown>;
  const { error: authUpdateError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...currentMetadata,
      display_name: displayName,
    },
  } as any);
  if (authUpdateError) return fail(500, authUpdateError.message);

  const { data: profileRow, error: profileSelectError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileSelectError) return fail(500, profileSelectError.message);

  if (profileRow?.id) {
    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", userId);
    if (profileUpdateError) return fail(500, profileUpdateError.message);
  } else {
    const { error: profileUpsertError } = await admin
      .from("profiles")
      .upsert(
        { id: userId, role: "user", display_name: displayName },
        { onConflict: "id" },
      );
    if (profileUpsertError) return fail(500, profileUpsertError.message);
  }

  return ok({
    user: {
      id: userId,
      email: existingUser.user.email || null,
      display_name: displayName,
    },
  });
};

const deleteUser = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return fail(500, error.message);
  return ok({ userId });
};

const banUser = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const hours = Math.max(1, Math.min(8760, Number(body?.hours || 24)));
  const { data, error } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: `${hours}h`,
  } as any);
  if (error) return fail(500, error.message);
  const bannedUntil = (data?.user as any)?.banned_until || null;
  return ok({ userId, banned_until: bannedUntil });
};

const unbanUser = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" } as any);
  if (error) return fail(500, error.message);
  return ok({ userId, banned_until: null });
};

const resetPassword = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) return fail(404, error?.message || "User not found");
  const email = data.user.email;
  if (!email) return badRequest("User has no email");

  const supabaseUrl = resolveSupabaseUrl();
  const supabaseAnonKey = resolveSupabaseAnonKey();
  if (!supabaseUrl || !supabaseAnonKey) {
    return fail(500, "Missing Supabase environment variables");
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { error: resetErr } = await anon.auth.resetPasswordForEmail(email, {
    redirectTo: `${Deno.env.get("PUBLIC_SITE_URL") || "http://localhost:3000"}`,
  });
  if (resetErr) return fail(500, resetErr.message);
  return ok({ userId, email });
};

const listBanks = async (req: Request, admin: ReturnType<typeof createServiceClient>) => {
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const sortBy = String(url.searchParams.get("sortBy") || "created_at");
  const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));

  let banks: any[] = [];
  let includeColor = true;
  {
    const { data, error } = await admin
      .from("banks")
      .select("id, title, description, color, created_at, created_by");
    if (error) {
      const isMissingColorColumn = /column .*color/i.test(error.message || "");
      if (!isMissingColorColumn) return fail(500, error.message);
      includeColor = false;
      const fallback = await admin
        .from("banks")
        .select("id, title, description, created_at, created_by");
      if (fallback.error) return fail(500, fallback.error.message);
      banks = fallback.data || [];
    } else {
      banks = data || [];
    }
  }

  const { data: accessRows, error: accessError } = await admin
    .from("user_bank_access")
    .select("bank_id");
  if (accessError) return fail(500, accessError.message);

  const accessCountMap = new Map<string, number>();
  for (const row of accessRows || []) {
    const bankId = (row as any).bank_id as string;
    accessCountMap.set(bankId, (accessCountMap.get(bankId) || 0) + 1);
  }

  const mapped = (banks || []).map((bank: any) => ({
    id: bank.id,
    title: bank.title || "",
    description: bank.description || "",
    color: includeColor ? (bank.color || null) : null,
    created_at: bank.created_at || null,
    created_by: bank.created_by || null,
    access_count: accessCountMap.get(bank.id) || 0,
  }));

  const filtered = q
    ? mapped.filter((bank) =>
        [bank.id, bank.title, bank.description].filter(Boolean).join(" ").toLowerCase().includes(q)
      )
    : mapped;

  const sorted = sortRows(filtered, sortBy, sortDir, {
    title: (a, b) => compareNullableText(a.title, b.title),
    created_at: (a, b) => compareNullableDate(a.created_at, b.created_at),
    access_count: (a, b) => a.access_count - b.access_count,
  });

  return ok({ banks: sorted, total: sorted.length, sortBy, sortDir });
};

const updateBank = async (bankId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const title = asString(body?.title, 120);
  const description = asString(body?.description, 2000) || "";
  const color = body?.color === null ? null : normalizeHexColor(body?.color);
  if (!title) return badRequest("title is required");
  if (body?.color !== undefined && body?.color !== null && !color) return badRequest("Invalid color");

  const updatePayload: Record<string, unknown> = { title, description };
  if (body?.color !== undefined) updatePayload.color = color;

  const attempt = await admin
    .from("banks")
    .update(updatePayload)
    .eq("id", bankId)
    .select("id, title, description, color, created_at, created_by")
    .single();

  if (attempt.error) {
    const isMissingColorColumn = /column .*color/i.test(attempt.error.message || "");
    if (!isMissingColorColumn) {
      return fail(500, attempt.error.message || "Failed to update bank");
    }

    const fallback = await admin
      .from("banks")
      .update({ title, description })
      .eq("id", bankId)
      .select("id, title, description, created_at, created_by")
      .single();
    if (fallback.error || !fallback.data) {
      return fail(500, fallback.error?.message || "Failed to update bank");
    }
    return ok({ bank: { ...fallback.data, color: null } });
  }

  if (!attempt.data) return fail(500, "Failed to update bank");
  return ok({ bank: attempt.data });
};

const deleteBank = async (bankId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const revokeAll = body?.revokeAll !== false;
  if (revokeAll) {
    const { error: revokeError } = await admin.from("user_bank_access").delete().eq("bank_id", bankId);
    if (revokeError) return fail(500, revokeError.message);
  }

  const { error: deleteError } = await admin.from("banks").delete().eq("id", bankId);
  if (deleteError) return fail(500, deleteError.message);
  return ok({ bankId, revokedAll: revokeAll });
};

const listAccessByUser = async (userId: string, admin: ReturnType<typeof createServiceClient>) => {
  const { data: rows, error } = await admin
    .from("user_bank_access")
    .select("id, user_id, bank_id, granted_at")
    .eq("user_id", userId)
    .order("granted_at", { ascending: false });
  if (error) return fail(500, error.message);

  const bankIds = Array.from(new Set((rows || []).map((row: any) => row.bank_id)));
  const { data: bankRows, error: banksError } = bankIds.length
    ? await admin.from("banks").select("id, title, description").in("id", bankIds)
    : { data: [], error: null };
  if (banksError) return fail(500, banksError.message);
  const bankMap = new Map((bankRows || []).map((bank: any) => [bank.id, bank]));

  const access = (rows || []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    bank_id: row.bank_id,
    granted_at: row.granted_at,
    bank: bankMap.get(row.bank_id) || null,
  }));
  return ok({
    userId,
    bankIds,
    access,
    total: access.length,
  });
};

const grantAccessForUser = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const bankIds = parseUuidList(body?.bankIds);
  if (!bankIds.length) return badRequest("bankIds is required");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return fail(500, profileError.message);
  if (profile?.role === "admin") return fail(400, "Cannot grant bank access to admin user");

  const payload = bankIds.map((bankId) => ({ user_id: userId, bank_id: bankId }));
  const { error } = await admin
    .from("user_bank_access")
    .upsert(payload, { onConflict: "user_id,bank_id" });
  if (error) return fail(500, error.message);

  return ok({ userId, bankIds, grantedCount: bankIds.length });
};

const revokeAccessForUser = async (userId: string, body: any, admin: ReturnType<typeof createServiceClient>) => {
  const bankIds = parseUuidList(body?.bankIds);
  if (!bankIds.length) return badRequest("bankIds is required");

  const { error } = await admin
    .from("user_bank_access")
    .delete()
    .eq("user_id", userId)
    .in("bank_id", bankIds);
  if (error) return fail(500, error.message);

  return ok({ userId, bankIds, revokedCount: bankIds.length });
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.response;

    const admin = createServiceClient();
    const url = new URL(req.url);
    const route = parseRoute(url.pathname);

    if (req.method === "GET" && route.section === "users" && !route.id) {
      return await listUsers(req, admin);
    }

    if (req.method === "GET" && route.section === "active-sessions") {
      return await listActiveSessions(req, admin);
    }

    if (req.method === "GET" && route.section === "banks" && !route.id) {
      return await listBanks(req, admin);
    }

    if (req.method === "GET" && route.section === "access" && route.id === "user" && route.action) {
      const userId = asUuid(route.action);
      if (!userId) return badRequest("Invalid user id");
      return await listAccessByUser(userId, admin);
    }

    if (req.method !== "POST") return fail(405, "Method not allowed");

    const body = await req.json().catch(() => ({}));

    if (route.section === "users" && route.id === "create") {
      return await createUser(body, admin);
    }

    if (route.section === "users" && route.id && route.action) {
      const userId = asUuid(route.id);
      if (!userId) return badRequest("Invalid user id");
      if (route.action === "update-profile") return await updateUserProfile(userId, body, admin);
      if (route.action === "delete") return await deleteUser(userId, admin);
      if (route.action === "ban") return await banUser(userId, body, admin);
      if (route.action === "unban") return await unbanUser(userId, admin);
      if (route.action === "reset-password") return await resetPassword(userId, admin);
      return fail(404, "Unknown admin route");
    }

    if (route.section === "banks" && route.id && route.action) {
      const bankId = asUuid(route.id);
      if (!bankId) return badRequest("Invalid bank id");
      if (route.action === "update") return await updateBank(bankId, body, admin);
      if (route.action === "delete") return await deleteBank(bankId, body, admin);
      return fail(404, "Unknown admin route");
    }

    if (route.section === "access" && route.id === "user" && route.action) {
      const segments = url.pathname.split("/").filter(Boolean);
      const adminIndex = segments.findIndex((segment) => segment === "admin-api");
      const userId = asUuid(segments[adminIndex + 3] || null);
      const accessAction = segments[adminIndex + 4] || null;
      if (!userId || !accessAction) return badRequest("Invalid access route");

      if (accessAction === "grant") return await grantAccessForUser(userId, body, admin);
      if (accessAction === "revoke") return await revokeAccessForUser(userId, body, admin);
      return fail(404, "Unknown access route");
    }

    return fail(404, "Unknown admin route");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return fail(500, message);
  }
});
