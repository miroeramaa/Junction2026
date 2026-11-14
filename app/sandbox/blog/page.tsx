import Link from "next/link";
import type { SandboxBlog } from "@/lib/types";
import { sandbox } from "../content";

export const dynamic = "force-dynamic";

export default async function SandboxBlogPage() {
  const { posts } = await sandbox<SandboxBlog>("blog");
  return (
    <section>
      <h1 className="text-3xl font-bold">Blog</h1>
      <ul className="mt-6 space-y-4">
        {posts.map((p) => (
          <li key={p.slug}>
            <Link href={`/sandbox/blog/${p.slug}`} className="text-xl font-semibold underline">{p.title}</Link>
            <p className="text-sm text-zinc-500">{p.date}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
