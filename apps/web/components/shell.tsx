import type { ReactNode } from 'react';
import Link from 'next/link';
import { TabBar } from './tab-bar';
import { SignOut } from './sign-out';
import { RegisterServiceWorker } from './register-sw';

/** Every crew screen has the same frame: a title, who you are, and the four
 *  places you can go. */
export function Shell({
  title,
  who,
  needsAnswer,
  aside,
  backToOffice = false,
  children,
}: {
  title: string;
  who: string;
  needsAnswer?: number;
  aside?: ReactNode;
  /**
   * A manager looking at the crew view needs the way back, or the only route
   * out of here is the browser's Back button. A crew member never sees it —
   * there is nothing on the other side they could open.
   */
  backToOffice?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <RegisterServiceWorker />
      <div className="shell">
        <header className="topbar">
          <div className="topbar-row">
            <div>
              <h1>{title}</h1>
              <p className="whoami">{who}</p>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {backToOffice ? (
                <Link
                  href="/calendar"
                  style={{ fontSize: 12.5, color: 'var(--muted)', textDecoration: 'none' }}
                >
                  ← Office
                </Link>
              ) : null}
              <SignOut variant="crew" />
            </span>
          </div>
          {aside}
        </header>
        <main>{children}</main>
      </div>
      <TabBar needsAnswer={needsAnswer} />
    </>
  );
}
