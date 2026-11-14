import type { SandboxCareers } from "@/lib/types";
import { sandbox } from "../content";

export const dynamic = "force-dynamic";

export default async function SandboxCareersPage() {
  const { jobs } = await sandbox<SandboxCareers>("careers");
  return (
    <section>
      <h1 className="text-3xl font-bold">Careers</h1>
      <ul className="mt-6 space-y-3">
        {jobs.map((j) => (
          <li key={j.title} className="rounded border border-zinc-200 p-4">
            <span className="font-semibold">{j.title}</span> · <span className="text-zinc-600">{j.location}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
