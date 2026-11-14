import Link from "next/link";

// A fake competitor ("Scrapr") we control, so we can trigger real changes on stage.
export default function SandboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <header className="border-b border-zinc-200">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-4">
          <Link href="/sandbox" className="text-lg font-bold">Scrapr</Link>
          <Link href="/sandbox/pricing">Pricing</Link>
          <Link href="/sandbox/blog">Blog</Link>
          <Link href="/sandbox/careers">Careers</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
    </div>
  );
}
