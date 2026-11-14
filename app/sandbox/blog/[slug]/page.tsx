import { notFound } from "next/navigation";
import type { SandboxBlog } from "@/lib/types";
import { sandbox } from "../../content";

export const dynamic = "force-dynamic";

export default async function SandboxPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = (await sandbox<SandboxBlog>("blog")).posts.find((p) => p.slug === slug);
  if (!post) notFound();
  return (
    <article>
      <h1 className="text-3xl font-bold">{post.title}</h1>
      <p className="text-sm text-zinc-500">{post.date}</p>
      <p className="mt-6 whitespace-pre-line">{post.body}</p>
    </article>
  );
}
