// Thin typed client for the Context.dev REST API.
// The only module that talks to Context.dev. Reused by the Next.js app later.

const BASE = "https://api.context.dev/v1";

function apiKey(): string {
  const key = process.env.CONTEXT_DEV_API_KEY;
  if (!key) throw new Error("Set CONTEXT_DEV_API_KEY (see .env.example)");
  return key;
}

const MAX_RATE_LIMIT_RETRIES = 6;

async function call<T>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      // Message says "Retry in N seconds"; header may say the same.
      const secs = Number(res.headers.get("retry-after")) || Number(/Retry in (\d+)/.exec(text)?.[1]) || 10;
      console.warn(`  rate limited on ${path}, retrying in ${secs}s`);
      await new Promise((r) => setTimeout(r, (secs + Math.random()) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Context.dev ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }
}

// ---------- Brand ----------

export type BrandCandidate = { domain: string; name: string; logo: string; description?: string };

export async function searchBrands(query: string): Promise<BrandCandidate[]> {
  const res = await call<{ results: BrandCandidate[] }>("GET", `/brand/search?query=${encodeURIComponent(query)}`);
  return res.results ?? [];
}

export type Brand = {
  domain: string;
  title?: string;
  description?: string;
  slogan?: string;
  logos?: { url: string; type?: string; mode?: string }[];
  industries?: { eic?: { industry: string; subindustry: string }[] };
  links?: { careers?: string | null; blog?: string | null; pricing?: string | null; [k: string]: string | null | undefined };
};

export async function retrieveBrand(domain: string): Promise<Brand> {
  const res = await call<{ brand: Brand }>("POST", "/brand/retrieve", { type: "by_domain", domain });
  return res.brand;
}

// ---------- Answers ----------

export async function answer<T>(task: string, jsonFormat: unknown, timeoutMs = 30_000) {
  return call<{ json_content: T; sources: string[]; partial?: boolean }>("POST", "/web/answers", {
    mode: "fast",
    task,
    json_format: jsonFormat,
    timeoutOpts: { milliseconds: timeoutMs, behavior: "return-partial" },
  });
}

// ---------- Scrape ----------

/** `maxAgeMs` defaults to 0 (always fetch fresh); the API's own default is a 3-day cache. */
export async function scrapeJson<T>(
  url: string,
  schema: object,
  opts: { instructions?: string; maxAgeMs?: number } = {},
): Promise<T | null> {
  const res = await call<{ json?: { success: boolean; data: T | null; error_code?: string; message?: string } }>(
    "POST",
    "/web/scrape",
    {
      url,
      formats: { json: true },
      jsonParams: { schema, ...(opts.instructions ? { instructions: opts.instructions } : {}) },
      maxAgeMs: opts.maxAgeMs ?? 0,
    },
  );
  if (!res.json?.success) throw new Error(`Extraction failed for ${url}: ${res.json?.error_code} ${res.json?.message}`);
  return res.json.data;
}

// ---------- Monitors ----------

export type MonitorTarget =
  | { type: "page"; url: string; instructions?: string; include_selectors?: string[]; exclude_selectors?: string[] }
  | { type: "sitemap"; url: string; include?: string[]; exclude?: string[] }
  | { type: "search"; query: string; instructions?: string };

export type Schedule = { type: "interval"; frequency: number; unit: "minutes" | "hours" | "days" };

export type Monitor = {
  id: string;
  name: string;
  status: string;
  next_run_at: string | null;
  webhook?: { url: string; secret?: string } | null;
};

export async function createMonitor(opts: {
  name: string;
  target: MonitorTarget;
  schedule?: Schedule;
  webhookUrl?: string;
  tags?: string[];
}): Promise<Monitor> {
  return call<Monitor>("POST", "/monitors", {
    name: opts.name,
    target: opts.target,
    ...(opts.schedule ? { schedule: opts.schedule } : {}),
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.webhookUrl
      ? { webhook: { url: opts.webhookUrl, events: ["change.detected", "run.completed"], retry: {} } }
      : {}),
  });
}

export const getMonitor = (id: string) => call<Monitor & { baseline: unknown }>("GET", `/monitors/${id}`);
export const deleteMonitor = (id: string) => call<unknown>("DELETE", `/monitors/${id}`);
export const runMonitorNow = (id: string) =>
  call<{ monitor_id: string; run_id: string; queued: boolean }>("POST", `/monitors/${id}/run`);

export type Run = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  run_type: "baseline" | "scheduled";
  change_detected?: boolean;
  change_id?: string | null;
  baseline_created?: boolean;
  started_at: string | null;
  completed_at: string | null;
  error?: { code: string; message: string } | null;
  skip_reason?: string;
};

export const listRuns = (id: string, limit = 5) =>
  call<{ data: Run[] }>("GET", `/monitors/${id}/runs?limit=${limit}`).then((r) => r.data);

export type Change = {
  id: string;
  monitor_id: string;
  run_id: string;
  target_type: "page" | "sitemap" | "extract" | "search";
  title: string;
  summary: string;
  importance?: "low" | "medium" | "high";
  confidence?: number;
  url: string;
  diff?: string;
  added_urls?: string[];
  removed_urls?: string[];
  matched_urls?: string[];
  detected_at: string;
};

export const listChanges = (id: string, limit = 10) =>
  call<{ data: Change[] }>("GET", `/monitors/${id}/changes?limit=${limit}`).then((r) => r.data);

// ---------- Batches (async multi-page scrape; separate, much higher rate limit) ----------

export type BatchUrl = { url: string; itemId: string };

export async function submitJsonBatch(opts: {
  urls: BatchUrl[];
  schema: object;
  instructions?: string;
  webhookUrl: string;
  maxAgeMs?: number;
}): Promise<{ id: string; status: string; webhook_secret: string }> {
  return call("POST", "/batch/submit", {
    input: {
      mode: "scrape",
      data: {
        formats: { json: true },
        urls: opts.urls,
        jsonParams: { schema: opts.schema, ...(opts.instructions ? { instructions: opts.instructions } : {}) },
        maxAgeMs: opts.maxAgeMs ?? 0,
      },
    },
    webhook: { url: opts.webhookUrl, retry: {} },
  });
}

export type BatchResult<T> = {
  url: string;
  itemId: string;
  status: "ok" | "error";
  result?: { json?: { success: boolean; data: T | null } };
};

export async function listBatchResults<T>(batchId: string): Promise<BatchResult<T>[]> {
  const out: BatchResult<T>[] = [];
  let cursor: string | null = null;
  do {
    const page: { data: BatchResult<T>[]; has_more: boolean; next_cursor: string | null } = await call(
      "GET",
      `/batch/${batchId}/results?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    out.push(...page.data);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return out;
}
