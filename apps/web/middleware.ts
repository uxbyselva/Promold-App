import { authMiddleware } from '@promold/app-kit/server';
import type { NextRequest } from 'next/server';
import { supabaseConfig } from '@/lib/env';

export async function middleware(request: NextRequest) {
  return authMiddleware(request, supabaseConfig());
}

// Written out rather than imported: Next.js reads this statically at build
// time, so an imported constant fails with "Unknown identifier".
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
};
