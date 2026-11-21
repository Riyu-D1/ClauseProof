// Optional Supabase backend for the "Beat the Analyst" leaderboard.
// When NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are
// set, plays are persisted to public.plays and shared across every viewer.
// When they're missing — or Supabase is unreachable — callers silently fall
// back to the in-memory store so the offline demo never breaks.
//
// The publishable key is browser-safe by design (RLS: anon select+insert).
// It's served to the client via /api/play/config at runtime so the hosted
// container needs no build-time secrets.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseConfig {
  url: string;
  key: string;
}

export function supabaseConfigFromEnv(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

let _client: SupabaseClient | null | undefined;

/** Server-side client (publishable key — RLS does the guarding). */
export function getSupabase(): SupabaseClient | null {
  if (_client === undefined) {
    const cfg = supabaseConfigFromEnv();
    _client = cfg
      ? createClient(cfg.url, cfg.key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  }
  return _client;
}
