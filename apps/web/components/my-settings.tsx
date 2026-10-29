'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refusalMessage } from '@promold/app-kit';
import { supabaseBrowser } from '@/lib/supabase-browser';

const KEY = 'promold.theme';
type Theme = 'system' | 'light' | 'dark';
const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'Follow the phone or the laptop' },
  { value: 'light', label: 'Light', hint: 'Always the pale one' },
  { value: 'dark', label: 'Dark', hint: 'Always the dark one' },
];

/**
 * Your own two details, and which theme you want.
 *
 * Name and phone are the only things on `profiles` you may change about
 * yourself. They go through `update_my_profile()` rather than a PATCH,
 * because the row policy that used to allow the PATCH could not stop the
 * same request writing `role_id` — see migration 0039.
 *
 * The theme never reaches the database. It is a per-device preference, not a
 * fact about the company: the same person wants dark on a phone in a crawl
 * space and light on the office monitor. So it lives in localStorage, written
 * here and read by the inline script in the root layout before the first
 * paint. Every access is wrapped because storage throws in a private window,
 * and the fallback — follow the system — is the right answer anyway.
 */
export function MySettings({
  initial,
  email,
  role,
}: {
  initial: { fullName: string; phone: string };
  email: string;
  role: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState<Theme>('system');

  // Read after mount, not during render: the server has no localStorage, so
  // reading it in the initial state would make the first client render differ
  // from the server's and React would throw away the markup.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      if (stored === 'light' || stored === 'dark') setTheme(stored);
    } catch {
      /* private window — stay on the system setting */
    }
  }, []);

  function chooseTheme(next: Theme) {
    setTheme(next);
    const root = document.documentElement;
    if (next === 'system') delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies to this page, it just will not be remembered */
    }
  }

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };
  const changed = form.fullName !== initial.fullName || form.phone !== initial.phone;

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabaseBrowser().rpc('update_my_profile', {
      p_full_name: form.fullName,
      p_phone: form.phone,
    });
    setBusy(false);
    if (err) {
      setError(refusalMessage(err));
      return;
    }
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="box">
        <header>
          <h3>You</h3>
          {saved ? <span className="sub">Saved.</span> : null}
        </header>
        <div className="body">
          {error ? <p className="err">{error}</p> : null}

          <div className="field">
            <label htmlFor="me-name">Name</label>
            <input
              id="me-name"
              value={form.fullName}
              autoComplete="name"
              onChange={(e) => set('fullName', e.target.value)}
            />
            <p className="hint">How you appear on a job, the crew list and the schedule.</p>
          </div>

          <div className="field">
            <label htmlFor="me-phone">Phone</label>
            <input
              id="me-phone"
              value={form.phone}
              type="tel"
              autoComplete="tel"
              placeholder="e.g. 416 555 0132"
              onChange={(e) => set('phone', e.target.value)}
            />
            <p className="hint">The number the office rings when a job changes.</p>
          </div>

          <dl className="kv">
            <div>
              <dt>Sign-in email</dt>
              <dd>{email || '—'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{role}</dd>
            </div>
          </dl>
          <p className="hint">
            Your email and your role are set by the office. Ask whoever looks after the app to
            change either.
          </p>

          <div className="btn-row">
            <button className="btn" disabled={!changed || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            {changed ? (
              <button
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setForm(initial);
                  setError(null);
                }}
              >
                Discard
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Appearance</h3>
        </header>
        <div className="body">
          <div className="seg" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                aria-pressed={theme === t.value}
                onClick={() => chooseTheme(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="hint">
            {THEMES.find((t) => t.value === theme)?.hint}. Remembered on this device only, so the
            phone in a crawl space and the office monitor can differ.
          </p>
        </div>
      </div>
    </>
  );
}
