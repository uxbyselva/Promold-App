/**
 * Config comes from the environment, never from a committed file.
 *
 * These MUST be literal `process.env.NEXT_PUBLIC_…` reads. Next.js inlines
 * them by substituting the text at build time, which only works on a static
 * reference — which is why this file is duplicated per app rather than shared.
 */
import { refusePrivilegedKey, type SupabaseConfig } from '@promold/app-kit';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const browserKey = publishableKey ?? legacyAnonKey;

function missing(what: string): never {
  throw new Error(
    `${what} In Vercel: Settings → Environment Variables, then redeploy — ` +
      `these are read at build time. Locally: copy apps/field/.env.example ` +
      `to .env.local.`,
  );
}

export const SUPABASE_URL = () => url ?? missing('NEXT_PUBLIC_SUPABASE_URL is not set.');

export const SUPABASE_ANON_KEY = () =>
  browserKey
    ? refusePrivilegedKey(browserKey)
    : missing(
        'No Supabase browser key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
          '(sb_publishable_…) or NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );

export const supabaseConfig = (): SupabaseConfig => ({
  url: SUPABASE_URL(),
  key: SUPABASE_ANON_KEY(),
});
