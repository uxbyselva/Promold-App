'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LoginForm } from '@promold/app-kit/login-form';
import { supabaseBrowser } from '@/lib/supabase-browser';

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  // Middleware records where they were heading, so a link to a job survives
  // the sign-in.
  const next = params.get('next') ?? '/jobs';

  return (
    <LoginForm
      title="Promold Field"
      subtitle="Your jobs, your mileage, your time off."
      envHint={
        'This app has no Supabase settings. Add NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel → Settings → Environment ' +
        'Variables, then redeploy — they are only read at build time.'
      }
      signIn={(email, password) => supabaseBrowser().auth.signInWithPassword({ email, password })}
      onSignedIn={() => {
        router.push(next);
        router.refresh();
      }}
    />
  );
}

export default function Login() {
  return (
    <Suspense>
      <Form />
    </Suspense>
  );
}
