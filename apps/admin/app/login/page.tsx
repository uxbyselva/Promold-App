'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function Login() {
  const router = useRouter();
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
      const { error } = await supabaseBrowser().auth.signInWithPassword({ email, password });

      if (error) {
        // Say what to do about it, not just what went wrong.
        setError(
          error.message === 'Invalid login credentials'
            ? 'That email and password did not match. Check both, or reset the password in Supabase.'
            : error.message,
        );
        setBusy(false);
        return;
      }
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      setError(
        message.includes('NEXT_PUBLIC_SUPABASE')
          ? 'This deployment has no Supabase settings. Add NEXT_PUBLIC_SUPABASE_URL and ' +
            'NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel → Settings → Environment Variables, ' +
            'then redeploy — they are only read at build time.'
          : `Could not reach Supabase: ${message}`,
      );
      setBusy(false);
      return;
    }

    router.push('/dispatch');
    router.refresh();
  }

  return (
    <main
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: '24px 16px',
      }}
    >
      <form
        onSubmit={onSubmit}
        className="card"
        style={{
          width: 'min(380px, 100%)',
          padding: 22,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600 }}>Promold</h1>
          <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 3 }}>
            Sign in to the dispatch board.
          </p>
        </div>

        {error ? <p className="err">{error}</p> : null}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
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

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
