// Context.dev webhook signature check, from https://docs.context.dev/webhooks.md
// Header `X-Context-Signature: t=<unix>,v1=<hex>`, where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`).
// Verify against the raw body bytes BEFORE parsing JSON.

import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody: Buffer, header: string, secret: string): boolean {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const parts: Record<string, string> = Object.create(null);
  for (const part of header.split(",")) {
    const pair = part.trim().split("=");
    if (pair.length !== 2 || Object.hasOwn(parts, pair[0])) return false;
    parts[pair[0]] = pair[1];
  }
  if (!/^[0-9]{1,12}$/.test(parts.t ?? "") || !/^[a-f0-9]{64}$/i.test(parts.v1 ?? "")) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.`).update(rawBody).digest();
  const actual = Buffer.from(parts.v1, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
