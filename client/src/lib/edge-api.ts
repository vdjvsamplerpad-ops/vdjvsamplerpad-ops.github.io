import { supabase, supabaseUrl } from '@/lib/supabase';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const trimLeadingSlash = (value: string) => value.replace(/^\/+/, '');

const configuredBase = (import.meta as any).env?.VITE_EDGE_FUNCTIONS_URL as string | undefined;
export const edgeFunctionsBaseUrl = trimTrailingSlash(
  configuredBase && configuredBase.trim().length > 0
    ? configuredBase
    : `${supabaseUrl}/functions/v1`
);

export const edgeFunctionUrl = (functionName: string, route = '') => {
  const suffix = route ? `/${trimLeadingSlash(route)}` : '';
  return `${edgeFunctionsBaseUrl}/${functionName}${suffix}`;
};

export const getAuthToken = async (): Promise<string | null> => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
};

export const getAuthHeaders = async (requireAuth = false): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (requireAuth && !token) {
    throw new Error('Not authenticated');
  }
  return headers;
};

