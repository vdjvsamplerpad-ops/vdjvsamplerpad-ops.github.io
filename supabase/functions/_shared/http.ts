const DEFAULT_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOW_METHODS = "GET,POST,OPTIONS";

const buildCorsHeaders = (req?: Request): Record<string, string> => {
  const origin = req?.headers.get("origin")?.trim() || "";
  const requestHeaders = req?.headers.get("access-control-request-headers")?.trim();
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": requestHeaders || DEFAULT_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": ALLOW_METHODS,
  };
  if (origin) {
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Vary"] = "Origin";
  }
  return headers;
};

export const corsHeaders: Record<string, string> = buildCorsHeaders();

export const handleCorsPreflight = (req: Request): Response | null => {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: buildCorsHeaders(req) });
};

export const json = (status: number, payload: unknown, req?: Request): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...buildCorsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

export const badRequest = (message: string, req?: Request): Response => json(400, { error: message }, req);

export const getEnvOrThrow = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
};
