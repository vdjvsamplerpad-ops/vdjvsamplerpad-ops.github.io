import { asObject, asString, extractPadNames } from "./validate.ts";

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

const isPrivateIp = (ip: string): boolean =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip.startsWith("10.") ||
  ip.startsWith("192.168.") ||
  ip.startsWith("172.16.") ||
  ip.startsWith("172.17.") ||
  ip.startsWith("172.18.") ||
  ip.startsWith("172.19.") ||
  ip.startsWith("172.2") ||
  ip.startsWith("172.3");

const fetchGeo = async (ip: string): Promise<Record<string, string> | null> => {
  try {
    if (!ip || isPrivateIp(ip)) return null;
    const resp = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, { method: "GET" });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data?.error) return null;
    return {
      city: data?.city || "",
      region: data?.region || "",
      country: data?.country_name || data?.country || "",
      timezone: data?.timezone || "",
      org: data?.org || data?.org_name || "",
    };
  } catch {
    return null;
  }
};

const mapDeviceForDisplay = (device: DevicePayload): string =>
  device.name ||
  device.model ||
  [device.platform, device.os, device.browser].filter(Boolean).join(" / ") ||
  "unknown";

const postDiscordWebhook = async (url: string, content: string) => {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

const postDiscordWebhookWithTextFile = async (
  url: string,
  content: string,
  fileName: string,
  fileText: string,
) => {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content }));
  form.append("file", new Blob([fileText], { type: "text/plain" }), fileName);
  const resp = await fetch(url, { method: "POST", body: form });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Discord webhook failed: ${resp.status} ${text}`);
  }
};

export const sendDiscordAuthEvent = async (input: {
  webhook: string | null;
  eventType: ActivityEventType;
  email: string;
  device: DevicePayload;
  status?: ActivityStatus;
  errorMessage?: string | null;
  clientIp?: string | null;
}) => {
  if (!input.webhook) return;
  const clientIp = input.clientIp || "unknown";
  const geo = clientIp !== "unknown" ? await fetchGeo(clientIp) : null;
  const eventName = input.eventType.replace("auth.", "").toUpperCase();
  const lines = [
    `**Auth Event:** ${eventName}`,
    input.status ? `**Status:** ${input.status.toUpperCase()}` : "",
    `**Email:** ${input.email}`,
    `**IP:** ${clientIp}`,
    `**Device:** ${mapDeviceForDisplay(input.device)}`,
    input.device?.model ? `**Model:** ${input.device.model}` : "",
    input.device?.platform ? `**Platform:** ${input.device.platform}` : "",
    input.device?.browser ? `**Browser:** ${input.device.browser}` : "",
    input.device?.os ? `**OS:** ${input.device.os}` : "",
    input.errorMessage ? `**Failed Message:** ${input.errorMessage}` : "",
    geo?.city || geo?.region || geo?.country
      ? `**Location:** ${[geo?.city, geo?.region, geo?.country].filter(Boolean).join(", ")}`
      : "",
    geo?.timezone ? `**Geo TZ:** ${geo.timezone}` : "",
    geo?.org ? `**Org:** ${geo.org}` : "",
  ].filter(Boolean);
  await postDiscordWebhook(input.webhook, lines.join("\n"));
};

export const sendDiscordExportEvent = async (input: {
  webhook: string | null;
  status?: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  errorMessage?: string | null;
}) => {
  if (!input.webhook) return;
  const lines = [
    "**Bank Export:**",
    input.status ? `**Status:** ${input.status.toUpperCase()}` : "",
    `**Email:** ${input.email}`,
    `**Bank:** ${input.bankName}`,
    `**Pad Count:** ${input.padNames.length}`,
    input.status === "failed" && input.errorMessage ? `**Failed Message:** ${input.errorMessage}` : "",
    "**Pad List:** attached as file",
  ].filter(Boolean);
  const sanitizedBankName = String(input.bankName).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "bank";
  const padListText = [
    `Bank: ${input.bankName}`,
    `Email: ${input.email}`,
    `Pad Count: ${input.padNames.length}`,
    "",
    ...(input.padNames.length ? input.padNames.map((name) => `- ${name}`) : ["- (no pads)"]),
  ].join("\n");
  await postDiscordWebhookWithTextFile(
    input.webhook,
    lines.join("\n"),
    `export_${sanitizedBankName}_pads.txt`,
    padListText,
  );
};

export const sendDiscordImportEvent = async (input: {
  webhook: string | null;
  status: ActivityStatus;
  email: string;
  bankName: string;
  padNames: string[];
  includePadList: boolean;
  errorMessage?: string | null;
}) => {
  if (!input.webhook) return;
  const normalizedStatus = input.status.toUpperCase();
  const shouldShowPads = input.includePadList && input.padNames.length > 0;
  const lines = [
    "**Bank Import:**",
    `**Status:** ${normalizedStatus}`,
    `**Email:** ${input.email}`,
    `**Bank:** ${input.bankName}`,
    normalizedStatus === "FAILED" && input.errorMessage ? `**Failed Message:** ${input.errorMessage}` : "",
    shouldShowPads ? `**Pad Count:** ${input.padNames.length}` : "",
    shouldShowPads ? "**Pad List:** attached as file" : "",
  ].filter(Boolean);

  if (!shouldShowPads) {
    await postDiscordWebhook(input.webhook, lines.join("\n"));
    return;
  }

  const sanitizedBankName = String(input.bankName).replace(/[^a-z0-9_-]/gi, "_").slice(0, 40) || "bank";
  const padListText = [
    `Bank: ${input.bankName}`,
    `Email: ${input.email}`,
    `Status: ${normalizedStatus}`,
    "",
    input.padNames.map((name) => `- ${name}`).join("\n"),
  ].join("\n");
  await postDiscordWebhookWithTextFile(
    input.webhook,
    lines.join("\n"),
    `import_${sanitizedBankName}_pads.txt`,
    padListText,
  );
};

export const parseDiscordWebhookPayload = (body: Record<string, unknown>) => ({
  status: String(body.status || "").toLowerCase() === "failed" ? "failed" : "success",
  email: asString(body.email, 320),
  bankName: asString(body.bankName, 200),
  padNames: extractPadNames(body.padNames),
  includePadList: Boolean(body.includePadList),
  errorMessage: asString(body.errorMessage, 2000),
  event: asString(body.event, 40),
  device: asObject(body.device),
});

