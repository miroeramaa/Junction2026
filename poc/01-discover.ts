// PoC step 1: company name → competitors with their pricing/blog/careers URLs.
// Usage: npm run poc:discover -- "context.dev"
// Writes poc/out/competitors.json

import { writeFile } from "node:fs/promises";
import { answer, retrieveBrand, searchBrands } from "../lib/context";

const query = process.argv[2] ?? "context.dev";
const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

// 1. Autocomplete — in the app the user picks one; here we take the first hit.
const candidates = await searchBrands(query);
if (!candidates.length) throw new Error(`No brand found for "${query}"`);
console.table(candidates.slice(0, 5).map((c) => ({ name: c.name, domain: c.domain })));
const me = candidates[0];
lap(`Picked ${me.name} (${me.domain})`);

// 2. Brand profile grounds the competitor search.
const myBrand = await retrieveBrand(me.domain);
const industries = myBrand.industries?.eic?.map((i) => `${i.industry} / ${i.subindustry}`).join(", ");
lap(`Brand: ${myBrand.description?.slice(0, 120)}… [${industries}]`);

// 3. Answers finds direct competitors.
const { json_content, sources } = await answer<{ competitors: { name: string; domain: string; why: string }[] }>(
  `List the 7 most direct competitors of ${myBrand.title ?? me.name} (${me.domain}). ` +
    `What it does: ${myBrand.description ?? "unknown"}. Industry: ${industries ?? "unknown"}. ` +
    `Only companies selling a substitute product to the same customers. Give each company's primary website domain (no protocol).`,
  { competitors: [{ name: "", domain: "", why: "" }] },
);
const competitors = (json_content.competitors ?? []).filter((c) => c.domain && c.domain !== me.domain);
lap(`Answers found ${competitors.length} competitors (${sources.length} sources)`);
console.table(competitors);

// 4. Brand per competitor gives logo + pricing/blog/careers links (parallel).
const enriched = await Promise.all(
  competitors.map(async (c) => {
    try {
      const b = await retrieveBrand(c.domain);
      return {
        name: c.name,
        domain: c.domain,
        why: c.why,
        logo: b.logos?.[0]?.url ?? null,
        pricing_url: b.links?.pricing ?? null,
        blog_url: b.links?.blog ?? null,
        careers_url: b.links?.careers ?? null,
        homepage_url: `https://${c.domain}`,
      };
    } catch (e) {
      console.warn(`  brand failed for ${c.domain}: ${(e as Error).message.slice(0, 120)}`);
      return { name: c.name, domain: c.domain, why: c.why, logo: null, pricing_url: null, blog_url: null, careers_url: null, homepage_url: `https://${c.domain}` };
    }
  }),
);
lap("Brand lookups done");
console.table(enriched.map(({ name, pricing_url, blog_url, careers_url }) => ({ name, pricing_url, blog_url, careers_url })));

await writeFile(
  new URL("./out/competitors.json", import.meta.url),
  JSON.stringify({ me: { name: myBrand.title ?? me.name, domain: me.domain, description: myBrand.description }, competitors: enriched }, null, 2),
);
lap("Wrote poc/out/competitors.json");
