'use client';

import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

/**
 * One sign-out button for both halves of the app.
 *
 * The office and the crew used to have their own copies, differing only in a
 * class name and push-vs-replace. `replace` is the right one everywhere: a
 * signed-out person pressing Back should not land on a page they can no
 * longer load.
 */
export function SignOut({ variant = 'office' }: { variant?: 'office' | 'crew' }) {
  const router = useRouter();
  return (
    <button
      className={variant === 'crew' ? 'btn plain sm' : 'btn ghost'}
      onClick={async () => {
        await supabaseBrowser().auth.signOut();
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
