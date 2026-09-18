/**
 * Config comes from the environment, never from a committed file.
 *
 * These MUST be written as literal `process.env.NEXT_PUBLIC_…` property
 * accesses. Next.js inlines them into the browser bundle by substituting the
 * text at build time, which only works on a static reference. An earlier
 * version read them through a helper as `process.env[name]`, and because a
 * computed key cannot be substituted, the values never reached the browser —
 * the app reported missing configuration on a deployment whose variables were
 * set correctly all along.
 *
 * Only the anon key is ever read here. It is safe in a browser bundle because
 * row-level security is what protects the data — it grants no more than the
 * signed-in user already has. The service_role key bypasses RLS entirely and
 * has no place in this app; if you find yourself reaching for it, the answer
 * is a policy or a security-definer function, not a bigger key.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function missing(name: string): never {
  throw new Error(
    `${name} is not set. In Vercel: Settings → Environment Variables, then ` +
      `redeploy — these are read at build time. Locally: copy ` +
      `apps/admin/.env.example to .env.local.`,
  );
}

export const SUPABASE_URL = () => url ?? missing('NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = () => anonKey ?? missing('NEXT_PUBLIC_SUPABASE_ANON_KEY');
