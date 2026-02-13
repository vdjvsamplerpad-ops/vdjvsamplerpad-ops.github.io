import { createClient } from "npm:@supabase/supabase-js@2";
import { getEnvOrThrow } from "./http.ts";

const resolveSupabaseUrl = (): string =>
  Deno.env.get("APP_SUPABASE_URL") || getEnvOrThrow("SUPABASE_URL");

const resolveSupabaseAnonKey = (): string =>
  Deno.env.get("APP_SUPABASE_ANON_KEY") || getEnvOrThrow("SUPABASE_ANON_KEY");

const resolveServiceRoleKey = (): string =>
  Deno.env.get("APP_SUPABASE_SERVICE_ROLE_KEY") || getEnvOrThrow("SUPABASE_SERVICE_ROLE_KEY");

export const createServiceClient = () => {
  const url = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

export const createUserScopedClient = (authHeader: string | null) => {
  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: authHeader ? { Authorization: authHeader } : {},
    },
  });
};

export const getUserFromAuthHeader = async (authHeader: string | null) => {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createUserScopedClient(authHeader);
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
};

export const isAdminUser = async (userId: string): Promise<boolean> => {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return false;
  return data.role === "admin";
};
