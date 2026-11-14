// PoC step 4: local webhook receiver. Saves every verified event to poc/out/webhooks/ as a fixture
// and prints the end-to-end latency (change detected → received here).
//
// Usage:
//   npm run poc:webhook                          listens on :8787
//   cloudflared tunnel --url http://localhost:8787   (or: ngrok http 8787) → public https URL
//   npm run poc:monitor -- create <pageUrl> <publicUrl>/webhook
//   put the printed secret in .env as CONTEXT_WEBHOOK_SECRET, restart this receiver

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { verifyWebhook } from "../lib/webhook";

const secret = process.env.CONTEXT_WEBHOOK_SECRET ?? "";
const outDir = new URL("./out/webhooks/", import.meta.url);
await mkdir(outDir, { recursive: true });

createServer(async (req, res) => {
  if (req.method !== "POST") return void res.writeHead(200).end("ok");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const receivedAt = Date.now();

  const sigOk = verifyWebhook(raw, String(req.headers["x-context-signature"] ?? ""), secret);
  if (!sigOk && secret) {
    console.log("✗ bad signature, rejected");
    return void res.writeHead(401).end();
  }
  const event = JSON.parse(raw.toString("utf8"));
  await writeFile(new URL(`${event.event}-${event.id}.json`, outDir), JSON.stringify(event, null, 2));

  const change = event.data?.change;
  const detected = change?.detected_at ? Date.parse(change.detected_at) : NaN;
  console.log(
    `${sigOk ? "✓" : "⚠ unverified (no CONTEXT_WEBHOOK_SECRET)"} ${event.event} ${event.id}` +
      (change ? `\n   [${change.importance ?? "-"}] ${change.title}\n   ${change.summary}` : "") +
      (Number.isFinite(detected) ? `\n   latency detected→received: ${((receivedAt - detected) / 1000).toFixed(1)}s` : ""),
  );
  res.writeHead(204).end();
}).listen(8787, () => console.log("Webhook receiver on http://localhost:8787"));
