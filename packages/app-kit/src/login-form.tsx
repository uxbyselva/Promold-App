'use client';

import { useState } from 'react';

export interface SignInResult {
  error: { message: string } | null;
}

/**
 * The sign-in form both apps use.
 *
 * It takes the sign-in call rather than building a client itself, because the
 * environment variables behind that client have to be read literally inside
 * the app being built (see each app's `lib/env.ts`).
 */
export function LoginForm({
  title,
  subtitle,
  signIn,
  onSignedIn,
  envHint,
}: {
  title: string;
  subtitle: string;
  signIn: (email: string, password: string) => Promise<SignInResult>;
  onSignedIn: () => void;
  envHint: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Anything thrown here used to leave the button saying "Signing in…"
    // forever: a missing environment variable, a network failure, a bad URL.
    // A spinner that never resolves tells the user nothing and looks like
    // their own mistake.
    try {
      const result = await signIn(email, password);
      if (result.error) {
        // Say what to do about it, not just what went wrong.
        setError(
          result.error.message === 'Invalid login credentials'
            ? 'That email and password did not match. Check both, or ask the office to reset it.'
            : result.error.message,
        );
        setBusy(false);
        return;
      }
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setError(message.includes('NEXT_PUBLIC_SUPABASE') ? envHint : `Could not sign in: ${message}`);
      setBusy(false);
      return;
    }

    onSignedIn();
  }

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 16px' }}>
      <form
        onSubmit={onSubmit}
        className="card"
        style={{ width: 'min(380px, 100%)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div>
          <h1>{title}</h1>
          <p className="sub" style={{ marginTop: 3 }}>
            {subtitle}
          </p>
        </div>

        {error ? <p className="err">{error}</p> : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn wide" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
