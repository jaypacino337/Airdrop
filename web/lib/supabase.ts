/**
 * Minimal server-side PostgREST client.
 *
 * The site only ever reads, and only ever with the anon key, so there is no
 * reason to pull in the full Supabase SDK. Keys are read on the server: the
 * browser never sees them.
 */
const url = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = Boolean(url && key);

export async function supabaseSelect<T>(path: string): Promise<T[]> {
  if (!supabaseConfigured) return [];
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Supabase ${path} -> ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return (await response.json()) as T[];
}

export async function supabaseSingle<T>(path: string): Promise<T | null> {
  const rows = await supabaseSelect<T>(path);
  return rows[0] ?? null;
}
