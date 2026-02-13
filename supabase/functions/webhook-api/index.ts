import "@supabase/functions-js/edge-runtime.d.ts";
import { handleCorsPreflight, json } from "../_shared/http.ts";
import {
  parseDiscordWebhookPayload,
  sendDiscordAuthEvent,
  sendDiscordExportEvent,
  sendDiscordImportEvent,
} from "../_shared/discord.ts";
import { asObject, asString, extractPadNames } from "../_shared/validate.ts";

const normalizeDevicePayload = (value: unknown) => {
  const raw = asObject(value);
  return {
    fingerprint: asString(raw.fingerprint, 256),
    name: asString(raw.name || raw.device || raw.platform || raw.ua, 200),
    model: asString(raw.model, 200),
    platform: asString(raw.platform, 120),
    browser: asString(raw.browser, 120),
    os: asString(raw.os, 120),
    raw: asObject(raw.raw || raw),
  };
};

const parseClientIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("X-Forwarded-For");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim() || "";
  return first.replace("::ffff:", "") || null;
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = await req.json().catch(() => ({}));
    const path = new URL(req.url).pathname;

    if (path.endsWith("/auth-event")) {
      const event = asString(body.event, 40);
      const email = asString(body.email, 320);
      if (!event || !email) return json(400, { error: "Missing event or email" });

      const mapped =
        event.toLowerCase() === "signup"
          ? "auth.signup"
          : event.toLowerCase() === "signout"
            ? "auth.signout"
            : "auth.login";

      await sendDiscordAuthEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
        eventType: mapped,
        email,
        device: normalizeDevicePayload(body.device),
        status: String(body.status || "").toLowerCase() === "failed" ? "failed" : "success",
        errorMessage: asString(body.errorMessage, 2000),
        clientIp: parseClientIp(req),
      });
      return json(200, { ok: true });
    }

    if (path.endsWith("/export-bank")) {
      const parsed = parseDiscordWebhookPayload(body);
      if (!parsed.email || !parsed.bankName) {
        return json(400, { error: "Missing email or bankName" });
      }
      const padNames = parsed.padNames.length ? parsed.padNames : extractPadNames(body.padNames);
      await sendDiscordExportEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_EXPORT") || null,
        status: parsed.status,
        email: parsed.email,
        bankName: parsed.bankName,
        padNames,
        errorMessage: parsed.errorMessage,
      });
      return json(200, { ok: true });
    }

    if (path.endsWith("/import-bank")) {
      const parsed = parseDiscordWebhookPayload(body);
      if (!parsed.email || !parsed.bankName) {
        return json(400, { error: "Missing email or bankName" });
      }
      await sendDiscordImportEvent({
        webhook: Deno.env.get("DISCORD_WEBHOOK_IMPORT") || null,
        status: parsed.status,
        email: parsed.email,
        bankName: parsed.bankName,
        padNames: parsed.padNames,
        includePadList: parsed.includePadList,
        errorMessage: parsed.errorMessage,
      });
      return json(200, { ok: true });
    }

    return json(404, { error: "Unknown webhook route" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: message });
  }
});

