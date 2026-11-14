"use client";

// Discovery progress, then choose which competitors to watch.

import { useState } from "react";
import { adminFetch } from "@/lib/admin-fetch";
import type { Competitor, Workspace } from "@/lib/types";

function Found({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "text-graphite" : "text-muted line-through"}>{label}</span>;
}

export function Review({ workspace, competitors }: { workspace: Workspace; competitors: Competitor[] }) {
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [sandbox, setSandbox] = useState(true);
  const [starting, setStarting] = useState(false);
  const ready = workspace.status === "review";
  const chosen = competitors.filter((c) => !unchecked.has(c.id));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h2 className="text-2xl font-semibold tracking-tight">
        {ready ? `${competitors.length} companies compete with ${workspace.name}` : "Looking for your competitors"}
      </h2>
      <p className="mt-2 max-w-prose text-graphite">
        {ready
          ? "Untick any that aren’t real competitors. For each one we watch its pricing page, new pages on its site, press coverage, careers page and homepage."
          : (workspace.status_detail ?? "Reading the web…")}
      </p>

      <ul className="mt-8 divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
        {competitors.map((c) => (
          <li key={c.id}>
            <label className={`flex gap-4 px-4 py-3.5 ${ready ? "cursor-pointer hover:bg-canvas/60" : ""}`}>
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-ink"
                disabled={!ready}
                checked={!unchecked.has(c.id)}
                onChange={() =>
                  setUnchecked((s) => {
                    const n = new Set(s);
                    if (n.has(c.id)) n.delete(c.id);
                    else n.add(c.id);
                    return n;
                  })
                }
              />
              {c.logo_url ? <img src={c.logo_url} alt="" className="mt-0.5 h-6 w-6 rounded object-contain" /> : <span className="h-6 w-6 rounded bg-canvas" />}
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{c.name}</span> <span className="text-[13px] text-muted">{c.domain}</span>
                {c.why && <span className="mt-0.5 block text-[13px] text-graphite">{c.why}</span>}
                <span className="mt-1 flex flex-wrap gap-x-3 text-[12px]">
                  <Found ok={!!c.pricing_url} label="Pricing page" />
                  <Found ok={!!c.blog_url} label="Blog" />
                  <Found ok={!!c.careers_url} label="Careers page" />
                </span>
              </span>
            </label>
          </li>
        ))}
        {!ready && <li className="px-4 py-3.5 text-[13px] text-muted">Searching…</li>}
      </ul>

      {ready && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <button
            disabled={starting || !chosen.length}
            className="rounded-md bg-ink px-4 py-2 font-semibold text-white disabled:opacity-60"
            onClick={async () => {
              setStarting(true);
              const res = await adminFetch(`/api/workspaces/${workspace.id}/confirm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ competitorIds: chosen.map((c) => c.id), sandbox }),
              });
              if (!res?.ok) setStarting(false);
            }}
          >
            {starting ? "Starting…" : `Watch ${chosen.length} competitors`}
          </button>
          <label className="flex items-center gap-2 text-[13px] text-graphite">
            <input type="checkbox" className="h-4 w-4 accent-ink" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
            Also add the demo competitor Scrapr, whose site we control
          </label>
        </div>
      )}
    </main>
  );
}
