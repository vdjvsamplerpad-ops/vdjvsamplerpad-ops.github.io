export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export const handleCorsPreflight = (req: Request): Response | null => {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: corsHeaders });
};

export const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const badRequest = (message: string): Response => json(400, { error: message });

export const getEnvOrThrow = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};
