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
 */
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

/**
 * Refuses a key that bypasses row-level security.
 *
 * Anything reaching this file is compiled into a public JavaScript bundle, so
 * a secret or service_role key here would hand every visitor unrestricted
 * read and write on every table. The base64 fragment is what
 * `"role":"service_role"` encodes to inside a JWT payload, which avoids
 * decoding the token just to check it.
 */
function rejectIfPrivileged(key: string): string {
  const looksPrivileged =
    key.startsWith('sb_secret_') || key.includes('InJvbGUiOiJzZXJ2aWNlX3JvbGUi');

  if (looksPrivileged) {
    throw new Error(
      'That is a secret / service_role key, and it is about to be published in ' +
        'a browser bundle where it would bypass every row-level security ' +
        'policy. Use the publishable key (sb_publishable_…) instead.',
    );
  }
  return key;
}

export const SUPABASE_URL = () => url ?? missing('NEXT_PUBLIC_SUPABASE_URL is not set.');

export const SUPABASE_ANON_KEY = () =>
  browserKey
    ? rejectIfPrivileged(browserKey)
    : missing(
        'No Supabase browser key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
          '(sb_publishable_…) or NEXT_PUBLIC_SUPABASE_ANON_KEY.',
      );
