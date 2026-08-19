import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env.js';

let client: SupabaseClient | undefined;

/** Service-role client. Server side only — it bypasses row level security. */
export function getSupabase(env: Env): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'trump-strategy-airdrop-worker' } },
    });
  }
  return client;
}
