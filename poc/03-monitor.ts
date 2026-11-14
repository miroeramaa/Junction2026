// PoC step 3: semantic pricing monitor → run now → see the change, with latency.
//
// Usage:
//   npm run poc:monitor -- create <url> [webhookUrl]   create a semantic pricing monitor (queues a baseline run)
//   npm run poc:monitor -- run <monitorId>             run now and wait for the result; prints change + latency
//   npm run poc:monitor -- changes <monitorId>         list recorded changes
//   npm run poc:monitor -- delete <monitorId>
//
// Test loop: point it at a page you can edit (e.g. a public GitHub Gist), `create`,
// wait for the baseline, edit a price on the page, then `run`.

import {
  createMonitor,
  deleteMonitor,
  getMonitor,
  listChanges,
  listRuns,
  runMonitorNow,
} from "../lib/context";

const PRICING_INSTRUCTIONS =
  "Only report changes to plan names, prices, billing periods, usage limits or included features. " +
  "Ignore layout, testimonials, logos, cookie banners and marketing copy.";

const [cmd, arg, webhookUrl] = process.argv.slice(2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForRun(monitorId: string, runId: string, startedAt: number) {
  for (;;) {
    const run = (await listRuns(monitorId, 5)).find((r) => r.id === runId);
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (run && ["completed", "failed", "skipped"].includes(run.status)) return { run, secs };
    process.stdout.write(`\r  ${run?.status ?? "queued"}… ${secs}s`);
    await sleep(1500);
  }
}

switch (cmd) {
  case "create": {
    if (!arg) throw new Error("create <url> [webhookUrl]");
    const m = await createMonitor({
      name: `PoC pricing: ${new URL(arg).hostname}`,
      target: { type: "page", url: arg, instructions: PRICING_INSTRUCTIONS },
      schedule: { type: "interval", frequency: 15, unit: "minutes" },
      webhookUrl,
      tags: ["poc"],
    });
    console.log(`Created ${m.id} (status ${m.status}, next run ${m.next_run_at})`);
    if (m.webhook?.secret) console.log(`Webhook secret (put in .env as CONTEXT_WEBHOOK_SECRET): ${m.webhook.secret}`);
    console.log("Waiting for baseline run…");
    const t = Date.now();
    for (;;) {
      const [run] = await listRuns(m.id, 1);
      if (run && ["completed", "failed", "skipped"].includes(run.status)) {
        console.log(`\nBaseline ${run.status} in ${((Date.now() - t) / 1000).toFixed(1)}s`, run.error ?? "");
        break;
      }
      process.stdout.write(".");
      await sleep(2000);
    }
    break;
  }
  case "run": {
    if (!arg) throw new Error("run <monitorId>");
    const t = Date.now();
    const { run_id } = await runMonitorNow(arg);
    console.log(`Queued run ${run_id}`);
    const { run, secs } = await waitForRun(arg, run_id, t);
    console.log(`\nRun ${run.status} after ${secs}s; change_detected=${run.change_detected}`, run.error ?? run.skip_reason ?? "");
    if (run.change_id) {
      const change = (await listChanges(arg, 5)).find((c) => c.id === run.change_id);
      console.log(JSON.stringify(change, null, 2));
    }
    break;
  }
  case "changes": {
    for (const c of await listChanges(arg, 20)) console.log(`${c.detected_at}  [${c.importance ?? "-"}] ${c.title}\n    ${c.summary}`);
    break;
  }
  case "status": {
    console.log(JSON.stringify(await getMonitor(arg), null, 2));
    break;
  }
  case "delete": {
    await deleteMonitor(arg);
    console.log(`Deleted ${arg}`);
    break;
  }
  default:
    console.log("Commands: create <url> [webhookUrl] | run <id> | changes <id> | status <id> | delete <id>");
}
