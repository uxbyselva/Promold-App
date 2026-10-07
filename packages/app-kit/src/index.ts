/**
 * What both apps need before they can show anyone anything: a Supabase client,
 * who is signed in, and what they may do.
 *
 * Two apps sharing one database is two chances to get auth subtly different.
 * Session loading, the permission shape and the middleware live here once.
 *
 * What deliberately does NOT live here is reading the environment variables.
 * Next.js inlines `process.env.NEXT_PUBLIC_…` by substituting the literal text
 * at build time, so those reads have to sit in the app being built. Each app
 * keeps its own `lib/env.ts` for that and hands the values in.
 */

export interface SupabaseConfig {
  url: string;
  key: string;
}

/**
 * Refuses a key that bypasses row-level security.
 *
 * Anything passed to a browser client is compiled into a public JavaScript
 * bundle, so a secret or service_role key here would hand every visitor
 * unrestricted read and write on every table. The base64 fragment is what
 * `"role":"service_role"` encodes to inside a JWT payload, which avoids
 * decoding the token just to check it.
 */
export function refusePrivilegedKey(key: string): string {
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

export interface Session {
  userId: string;
  email: string;
  fullName: string;
  orgId: string;
  roleKey: string;
  roleName: string;
  permissions: Record<string, boolean>;
  /** Mirrors has_permission() in SQL. The database still decides; this only
   *  shapes what the UI offers. */
  can: (flag: string) => boolean;
}

/**
 * Turns whatever a database function refused with into the sentence to show.
 *
 * Every guard in this system is a Postgres exception whose message was written
 * to be read by the person who hit it — "This customer still has 3 sites",
 * not "23503". PostgREST prefixes those, so strip the prefix and keep the
 * sentence.
 */
export function refusalMessage(error: { message: string } | null | undefined): string | null {
  if (!error) return null;
  const message = error.message.replace(/^.*?:\s*/, '').trim();
  return message.length > 0 ? message : error.message;
}
