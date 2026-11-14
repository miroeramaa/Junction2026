// Provenance: every number or claim on the dashboard links back to the page it was read from.
// One look everywhere: a small muted "host/path ↗" link.

export function sourceLabel(url: string, maxPath = 24): string {
  try {
    const u = new URL(url);
    // Archived copies: name the archive and the page, not the long web.archive.org path.
    const archived = u.hostname === "web.archive.org" ? u.pathname.match(/^\/web\/[^/]+\/(.+)$/) : null;
    if (archived) return `Wayback Machine: ${sourceLabel(archived[1].startsWith("http") ? archived[1] : `https://${archived[1]}`, maxPath)}`;
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    if (!path) return host;
    return `${host}${path.length > maxPath ? `${path.slice(0, maxPath - 1)}…` : path}`;
  } catch {
    return url;
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function SourceLink({ href, label, className = "" }: { href: string; label?: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex max-w-full items-baseline gap-0.5 text-muted underline decoration-hairline underline-offset-2 hover:text-ink hover:decoration-current ${className}`}
    >
      <span className="truncate">{label ?? sourceLabel(href)}</span>
      <span aria-hidden className="shrink-0 text-[0.9em]">↗</span>
    </a>
  );
}

/** Wayback URL for the copy captured at `iso` (Wayback redirects to the nearest capture). */
export function waybackUrl(pageUrl: string, iso: string): string {
  const stamp = iso.replace(/\D/g, "").slice(0, 14);
  return `https://web.archive.org/web/${stamp}/${pageUrl}`;
}

/** Every archived copy of a page, as a calendar. */
export const waybackIndex = (pageUrl: string) => `https://web.archive.org/web/*/${pageUrl}`;
