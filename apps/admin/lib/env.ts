/**
 * Config comes from the environment, never from a committed file.
 *
 * Only the anon key is ever read here. It is safe in a browser bundle because
 * row-level security is what protects the data — it grants no more than the
 * signed-in user already has. The service_role key bypasses RLS entirely and
 * has no place in this app; if you find yourself reaching for it, the answer
 * is a policy or a security-definer function, not a bigger key.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy apps/admin/.env.example to .env.local and fill ` +
        `it in from Supabase → Project Settings → API.`,
    );
  }
  return value;
}

export const SUPABASE_URL = () => required('NEXT_PUBLIC_SUPABASE_URL');
export const SUPABASE_ANON_KEY = () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
