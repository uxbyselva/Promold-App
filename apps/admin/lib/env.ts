/**
 * Config comes from the environment, never from a committed file.
 *
 * These MUST be written as literal `process.env.NEXT_PUBLIC_…` property
 * accesses. Next.js inlines them into the browser bundle by substituting the
 * text at build time, which only works on a static reference. An earlier
 * version read them through a helper as `process.env[name]`, and because a
 * computed key cannot be substituted, the values never reached the browser —
 * the app reported missing configuration on a deployment whose variables were
 * set correctly all along. That is also why this file is not shared with the
 * field app: each app has to do its own literal reads.
 */
import { refusePrivilegedKey, type SupabaseConfig } from '@promold/app-kit';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Supabase issues publishable keys (sb_publishable_…) to new projects and has
// begun disabling the legacy JWT anon keys (eyJ…). Both go in the same place
// and mean the same thing to the client, so accept either name.
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const browserKey = publishableKey ?? legacyAnonKey;

function missing(what: string): never {
  throw new Error(
    `${what} In Vercel: Settings → Environment Variables, then redeploy — ` +
      `these are read at build time. Locally: copy apps/admin/.env.example ` +
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
