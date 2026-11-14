"use client";

// On-stage control panel for the fake competitor: change a price, publish a post, then hit "Sweep now" in the app.

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { SandboxBlog, SandboxPricing } from "@/lib/types";

async function save(page: string, content: unknown) {
  const token = typeof window !== "undefined" ? (localStorage.getItem("sandboxToken") ?? "") : "";
  const res = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": token },
    body: JSON.stringify({ page, content }),
  });
  if (!res.ok) alert(`Save failed: ${res.status}`);
}

export default function SandboxAdmin() {
  const [pricing, setPricing] = useState<SandboxPricing | null>(null);
  const [blog, setBlog] = useState<SandboxBlog | null>(null);
  const [post, setPost] = useState({ title: "Launching Enterprise SSO", body: "SAML SSO and audit logs are now available on all paid plans." });
  const [status, setStatus] = useState("");

  useEffect(() => {
    supabaseBrowser()
      .from("sandbox_content")
      .select("page, content")
      .then(({ data }) => {
        setPricing(data?.find((r) => r.page === "pricing")?.content ?? null);
        setBlog(data?.find((r) => r.page === "blog")?.content ?? null);
      });
  }, []);

  if (!pricing || !blog) return <p>Loading…</p>;

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-bold">Sandbox admin</h1>
      {status && <p className="rounded bg-green-50 p-2 text-green-800">{status}</p>}

      <section>
        <h2 className="text-xl font-semibold">Pricing</h2>
        <div className="mt-4 space-y-2">
          {pricing.plans.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24">{p.name}</span>
              <span>$</span>
              <input
                type="number"
                className="w-24 rounded border px-2 py-1"
                value={p.price}
                onChange={(e) => {
                  const plans = [...pricing.plans];
                  plans[i] = { ...p, price: Number(e.target.value) };
                  setPricing({ plans });
                }}
              />
              <input
                className="flex-1 rounded border px-2 py-1"
                value={p.limits}
                onChange={(e) => {
                  const plans = [...pricing.plans];
                  plans[i] = { ...p, limits: e.target.value };
                  setPricing({ plans });
                }}
              />
            </div>
          ))}
        </div>
        <button
          className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white"
          onClick={async () => {
            await save("pricing", pricing);
            setStatus(`Pricing published at ${new Date().toLocaleTimeString()}`);
          }}
        >
          Publish pricing
        </button>
      </section>

      <section>
        <h2 className="text-xl font-semibold">New blog post</h2>
        <input className="mt-4 w-full rounded border px-2 py-1" value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} />
        <textarea className="mt-2 w-full rounded border px-2 py-1" rows={3} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} />
        <button
          className="mt-2 rounded bg-zinc-900 px-4 py-2 text-white"
          onClick={async () => {
            const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
            const next = { posts: [{ slug, title: post.title, body: post.body, date: new Date().toISOString().slice(0, 10) }, ...blog.posts] };
            await save("blog", next);
            setBlog(next);
            setStatus(`Post "${post.title}" published at ${new Date().toLocaleTimeString()}`);
          }}
        >
          Publish post
        </button>
      </section>
    </div>
  );
}
