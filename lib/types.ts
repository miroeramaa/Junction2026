// Shared row types. Mirror supabase/migrations/0001_init.sql; change both together.

import type { Plan } from "./pricing";

export type Signal = "pricing" | "launches" | "news" | "hiring" | "positioning";

export type Workspace = {
  id: string;
  name: string;
  domain: string;
  description: string | null;
  logo_url: string | null;
  status: "discovering" | "review" | "watching" | "error";
  status_detail: string | null;
  created_at: string;
};

export type Competitor = {
  id: string;
  workspace_id: string;
  name: string;
  domain: string;
  why: string | null;
  logo_url: string | null;
  pricing_url: string | null;
  blog_url: string | null;
  careers_url: string | null;
  homepage_url: string | null;
  is_sandbox: boolean;
  confirmed: boolean;
  created_at: string;
};

export type EventRow = {
  id: string;
  competitor_id: string;
  monitor_id: string | null;
  signal: Signal;
  context_event_id: string;
  title: string | null;
  summary: string | null;
  importance: "low" | "medium" | "high" | null;
  url: string | null;
  diff: string | null;
  detected_at: string | null;
  received_at: string;
  processed_at: string | null;
  battlecard_updated_at: string | null;
};

export type FeedItem = { title: string; summary?: string | null; url?: string | null; at: string };

export type Battlecard = {
  competitor_id: string;
  pricing: { plans: Plan[]; captured_at: string } | null;
  launches: FeedItem[];
  news: FeedItem[];
  hiring: FeedItem[];
  positioning: FeedItem | null;
  how_to_win: string | null;
  updated_at: string;
  last_event_id: string | null;
};

export type PricingSnapshot = {
  id: string;
  competitor_id: string;
  captured_at: string;
  source: "wayback" | "live";
  plans: Plan[];
};

export type SandboxPricing = { plans: { name: string; price: number; limits: string }[] };
export type SandboxBlog = { posts: { slug: string; title: string; date: string; body: string }[] };
export type SandboxCareers = { jobs: { title: string; location: string }[] };
