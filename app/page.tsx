"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { Workspace } from "@/lib/types";

type Candidate = { domain: string; name: string; logo: string };

const WATCHED = [
  ["Pricing pages", "every 15 minutes"],
  ["New blog posts and pages", "hourly"],
  ["Press coverage", "hourly"],
  ["Careers pages", "hourly"],
  ["Homepage messaging", "hourly"],
];

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabaseBrowser()
      .from("workspaces")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setWorkspaces(data ?? []));
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/brand-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results ?? []);
          setActive(0);
        })
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function start(c: Candidate) {
    setBusy(c.domain);
    const res = await adminFetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: c.domain, name: c.name }),
    });
    if (!res?.ok) return setBusy(null);
    const { id } = await res.json();
    router.push(`/w/${id}`);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-16 lg:py-24">
      <p className="text-[13px] font-semibold text-graphite">Competitor Radar</p>
      <h1 className="mt-4 max-w-3xl text-4xl leading-[1.08] font-semibold tracking-tight text-balance sm:text-5xl">
        Know what your competitors changed{" "}
        <span className="text-graphite">
          <span className="struck">last quarter</span> <span className="inserted">this morning</span>.
        </span>
      </h1>
      <p className="mt-5 max-w-xl text-[16px] text-graphite">
        Name your company. We find your competitors, watch their websites and the press, and keep a battlecard for each one
        up to date as things change.
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <label htmlFor="company" className="text-[13px] font-semibold">Your company</label>
          <div className="relative mt-2">
            <input
              id="company"
              ref={input}
              autoFocus
              autoComplete="off"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="company-results"
              className="w-full rounded-lg border border-hairline bg-surface px-4 py-3.5 text-lg shadow-[0_1px_0_rgba(21,23,28,0.04)] outline-none focus:border-ink"
              placeholder="Start typing a name or domain"
              value={q}
              disabled={!!busy}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
                if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
                if (e.key === "Enter" && results[active]) start(results[active]);
              }}
            />
            {results.length > 0 && (
              <ul id="company-results" role="listbox" className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-hairline bg-surface shadow-lg">
                {results.map((c, i) => (
                  <li key={c.domain} role="option" aria-selected={i === active}>
                    <button
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i === active ? "bg-canvas" : ""}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => start(c)}
                      disabled={!!busy}
                    >
                      {c.logo ? <img src={c.logo} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6 rounded bg-canvas" />}
                      <span className="font-semibold">{c.name || c.domain}</span>
                      <span className="text-[13px] text-muted">{c.domain}</span>
                      {busy === c.domain && <span className="ml-auto text-[13px] text-graphite">Opening…</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {workspaces.length > 0 && (
            <section className="mt-12">
              <h2 className="text-[13px] font-semibold">Companies you already watch</h2>
              <ul className="mt-3 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
                {workspaces.map((w) => (
                  <li key={w.id}>
                    <Link href={`/w/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas/60">
                      {w.logo_url ? <img src={w.logo_url} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6 rounded bg-canvas" />}
                      <span className="font-semibold">{w.name}</span>
                      <span className="text-[13px] text-muted">{w.domain}</span>
                      <span className="ml-auto text-[13px] text-graphite">
                        {w.status === "watching" ? "Watching" : w.status === "review" ? "Waiting for you to pick competitors" : w.status === "error" ? "Setup stopped" : "Setting up"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside>
          <h2 className="text-[13px] font-semibold">What we watch for each competitor</h2>
          <dl className="mt-3 divide-y divide-hairline border-y border-hairline text-[14px]">
            {WATCHED.map(([what, how]) => (
              <div key={what} className="flex justify-between gap-4 py-2.5">
                <dt>{what}</dt>
                <dd className="text-muted">{how}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[13px] text-graphite">
            Pricing history is rebuilt from archived copies of each pricing page, so you see how prices moved before you started watching.
          </p>
        </aside>
      </div>
    </main>
  );
}
