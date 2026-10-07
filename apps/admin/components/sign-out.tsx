'use client';

import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn ghost"
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.push('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
