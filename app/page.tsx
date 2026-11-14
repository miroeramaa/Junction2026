"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Candidate = { domain: string; name: string; logo: string };

export default function Home() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/brand-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  async function start(c: Candidate) {
    setBusy(true);
    const res = await fetch("/api/onboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: c.domain, name: c.name }),
    });
    const { id } = await res.json();
    router.push(`/w/${id}`);
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-24">
      <h1 className="text-4xl font-bold">Competitor Radar</h1>
      <p className="mt-3 text-zinc-500">
        Type your company. We find your competitors and watch their pricing, launches, press and hiring on the live web.
      </p>
      <input
        autoFocus
        className="mt-8 w-full rounded-lg border border-zinc-300 bg-transparent px-4 py-3 text-lg"
        placeholder="Your company, e.g. context.dev"
        value={q}
        disabled={busy}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 empty:hidden">
        {results.map((c) => (
          <li key={c.domain}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-100/10" onClick={() => start(c)} disabled={busy}>
              {c.logo ? <img src={c.logo} alt="" className="h-6 w-6 rounded" /> : <span className="h-6 w-6" />}
              <span className="font-medium">{c.name || c.domain}</span>
              <span className="text-sm text-zinc-500">{c.domain}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
