import "@supabase/functions-js/edge-runtime.d.ts"
import { badRequest, handleCorsPreflight, json } from "../_shared/http.ts";
import { createServiceClient, isAdminUser } from "../_shared/supabase.ts";
import { asNumber, asObject, asString, asUuid, extractPadNames } from "../_shared/validate.ts";
import { sendDiscordAuthEvent, sendDiscordExportEvent, sendDiscordImportEvent } from "../_shared/discord.ts";

type ActivityEventType =
  | "auth.login"
  | "auth.signup"
  | "auth.signout"
  | "bank.export"
  | "bank.import";
type ActivityStatus = "success" | "failed";
type DevicePayload = {
  fingerprint?: string | null;
  name?: string | null;
  model?: string | null;
  platform?: string | null;
  browser?: string | null;
  os?: string | null;
  raw?: Record<string, unknown> | null;
};

const EVENT_TYPES: ActivityEventType[] = [
  "auth.login",
  "auth.signup",
  "auth.signout",
  "bank.export",
  "bank.import",
];

const STATUS_VALUES: ActivityStatus[] = ["success", "failed"];

const isEventType = (value: unknown): value is ActivityEventType =>
  typeof value === "string" && EVENT_TYPES.includes(value as ActivityEventType);

const isStatus = (value: unknown): value is ActivityStatus =>
  typeof value === "string" && STATUS_VALUES.includes(value as ActivityStatus);

const normalizeDevice = (value: unknown): DevicePayload => {
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

const parseClientIp = (req: Request): string | null => {
  const forwarded = req.headers.get("x-forwarded-for") || req.headers.get("X-Forwarded-For");
  if (!forwarded) return null;
  const first = forwarded.split(",")[0]?.trim() || "";
  return first.replace("::ffff:", "") || null;
};

const writeActivityLog = async (payload: {
  requestId: string;
  eventType: ActivityEventType;
  status: ActivityStatus;
  userId?: string | null;
  email?: string | null;
  sessionKey?: string | null;
  device: DevicePayload;
  bankId?: string | null;
  bankName?: string | null;
  padCount?: number | null;
  errorMessage?: string | null;
  meta?: Record<string, unknown>;
}) => {
  const admin = createServiceClient();
  const { error } = await admin
    .from("activity_logs")
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
      meta: asObject(payload.meta),
    })
    .select("id")
    .single();

  if (!error) return { deduped: false };
  if (error.code === "23505" || /duplicate key/i.test(error.message || "")) {
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
  const admin = createServiceClient();

  const rpc = await admin.rpc("upsert_active_session", {
    p_session_key: payload.sessionKey,
    p_user_id: payload.userId,
    p_email: payload.email || null,
    p_device_fingerprint: payload.device.fingerprint || "unknown",
    p_device_name: payload.device.name || null,
    p_device_model: payload.device.model || null,
    p_platform: payload.device.platform || null,
    p_browser: payload.device.browser || null,
    p_os: payload.device.os || null,
    p_ip: payload.ip || null,
    p_last_event: payload.lastEvent || null,
    p_meta: asObject(payload.meta),
  });

  if (!rpc.error) return;

  const fallback = await admin
    .from("active_sessions")
    .upsert(
      {
        session_key: payload.sessionKey,
        user_id: payload.userId,
        email: payload.email || null,
        device_fingerprint: payload.device.fingerprint || "unknown",
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
      { onConflict: "session_key" },
    );

  if (fallback.error) throw new Error(fallback.error.message || rpc.error.message);
};

const markSessionOffline = async (sessionKey: string, lastEvent = "auth.signout") => {
  const admin = createServiceClient();
  const rpc = await admin.rpc("mark_session_offline", {
    p_session_key: sessionKey,
    p_last_event: lastEvent,
  });
  if (!rpc.error) return;

  const fallback = await admin
    .from("active_sessions")
    .update({ is_online: false, last_seen_at: new Date().toISOString(), last_event: lastEvent })
    .eq("session_key", sessionKey);
  if (fallback.error) throw new Error(fallback.error.message || rpc.error.message);
};

Deno.serve(async (req) => {
  const cors = handleCorsPreflight(req);
  if (cors) return cors;

  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const url = new URL(req.url);
    const route = url.pathname.split("/").pop() || "";
    const body = await req.json().catch(() => ({}));

    if (route === "event") {
      const requestId = asUuid(body.requestId);
      const eventType = body.eventType;
      const status = body.status;
      if (!requestId) return badRequest("Missing or invalid requestId");
      if (!isEventType(eventType)) return badRequest("Invalid eventType");
      if (!isStatus(status)) return badRequest("Invalid status");

      const userId = asUuid(body.userId);
      const sessionKey = asUuid(body.sessionKey);
      const email = asString(body.email, 320);
      const device = normalizeDevice(body.device);
      const bankName = asString(body.bankName, 200);
      const bankId = asString(body.bankId, 200);
      const errorMessage = asString(body.errorMessage, 2000);
      const meta = asObject(body.meta);
      const padNames = extractPadNames(body.padNames);
      const explicitPadCount = asNumber(body.padCount);
      const padCount = explicitPadCount ?? (padNames.length ? padNames.length : null);
      if (userId && (await isAdminUser(userId))) return json(200, { ok: true, skippedAdmin: true });

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
      if (result.deduped) return json(200, { ok: true, deduped: true });

      if (status === "success") {
        if (eventType === "auth.signout") {
          if (sessionKey) await markSessionOffline(sessionKey, "auth.signout");
        } else if (sessionKey && userId) {
          await upsertActiveSession({
            sessionKey,
            userId,
            email,
            device,
            ip: parseClientIp(req),
            lastEvent: eventType,
            meta,
          });
        }
      }
      let discordError: string | null = null;
      try {
        if (eventType.startsWith("auth.")) {
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType,
            email: email || "unknown",
            device,
            status,
            errorMessage,
            clientIp: parseClientIp(req),
          });
        } else if (eventType === "bank.export") {
          await sendDiscordExportEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_EXPORT") || null,
            status,
            email: email || "unknown",
            bankName: bankName || "unknown",
            padNames,
            errorMessage,
          });
        } else if (eventType === "bank.import") {
          await sendDiscordImportEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_IMPORT") || null,
            status,
            email: email || "unknown",
            bankName: bankName || "unknown",
            padNames,
            includePadList: Boolean(meta.includePadList),
            errorMessage,
          });
        }
      } catch (err) {
        discordError = err instanceof Error ? err.message : "Discord fanout failed";
        console.warn("Discord fanout warning:", discordError);
      }
      return json(200, { ok: true, discordError });
    }

    if (route === "heartbeat") {
      const sessionKey = asUuid(body.sessionKey);
      const userId = asUuid(body.userId);
      if (!sessionKey) return badRequest("Missing or invalid sessionKey");
      if (!userId) return badRequest("Missing or invalid userId");
      if (await isAdminUser(userId)) return json(200, { ok: true, skippedAdmin: true });

      await upsertActiveSession({
        sessionKey,
        userId,
        email: asString(body.email, 320),
        device: normalizeDevice(body.device),
        ip: parseClientIp(req),
        lastEvent: asString(body.lastEvent, 60) || "heartbeat",
        meta: asObject(body.meta),
      });
      return json(200, { ok: true });
    }

    if (route === "signout") {
      const requestId = asUuid(body.requestId);
      const sessionKey = asUuid(body.sessionKey);
      const userId = asUuid(body.userId);
      const status = isStatus(body.status) ? body.status : "success";
      if (!requestId) return badRequest("Missing or invalid requestId");
      if (!sessionKey) return badRequest("Missing or invalid sessionKey");
      if (userId && (await isAdminUser(userId))) return json(200, { ok: true, skippedAdmin: true });

      const result = await writeActivityLog({
        requestId,
        eventType: "auth.signout",
        status,
        userId,
        email: asString(body.email, 320),
        sessionKey,
        device: normalizeDevice(body.device),
        errorMessage: asString(body.errorMessage, 2000),
        meta: asObject(body.meta),
      });

      if (!result.deduped && status === "success") {
        await markSessionOffline(sessionKey, "auth.signout");
      }
      let discordError: string | null = null;
      try {
        if (!result.deduped) {
          await sendDiscordAuthEvent({
            webhook: Deno.env.get("DISCORD_WEBHOOK_AUTH") || null,
            eventType: "auth.signout",
            email: asString(body.email, 320) || "unknown",
            device: normalizeDevice(body.device),
            status,
            errorMessage: asString(body.errorMessage, 2000),
            clientIp: parseClientIp(req),
          });
        }
      } catch (err) {
        discordError = err instanceof Error ? err.message : "Discord fanout failed";
        console.warn("Discord fanout warning:", discordError);
      }
      return json(200, { ok: true, deduped: result.deduped, discordError });
    }

    return json(404, { error: "Unknown activity route" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json(500, { error: message });
  }
});
