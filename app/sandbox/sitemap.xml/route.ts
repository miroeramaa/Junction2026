// Sitemap for the sandbox blog, watched by the "launches" sitemap monitor.

import { appUrl } from "@/lib/db";
import type { SandboxBlog } from "@/lib/types";
import { sandbox } from "../content";

export const dynamic = "force-dynamic";

export async function GET() {
  const { posts } = await sandbox<SandboxBlog>("blog");
  const base = appUrl();
  const urls = [`${base}/sandbox`, `${base}/sandbox/pricing`, `${base}/sandbox/blog`, ...posts.map((p) => `${base}/sandbox/blog/${p.slug}`)];
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
