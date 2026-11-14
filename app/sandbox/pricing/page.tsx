import type { SandboxPricing } from "@/lib/types";
import { sandbox } from "../content";

export const dynamic = "force-dynamic";

export default async function SandboxPricingPage() {
  const { plans } = await sandbox<SandboxPricing>("pricing");
  return (
    <section>
      <h1 className="text-3xl font-bold">Pricing</h1>
      <p className="mt-2 text-zinc-600">All prices in USD, billed monthly.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.name} className="rounded-lg border border-zinc-200 p-6">
            <h2 className="text-xl font-semibold">{p.name}</h2>
            <p className="mt-2 text-3xl font-bold">${p.price}<span className="text-base font-normal">/month</span></p>
            <p className="mt-2 text-zinc-600">{p.limits}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
