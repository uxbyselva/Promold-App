import type { ReactNode } from 'react';
import { TabBar } from './tab-bar';
import { SignOut } from './sign-out';
import { RegisterServiceWorker } from './register-sw';

/** Every screen in the field app has the same frame: a title, who you are, and
 *  the three places you can go. */
export function Shell({
  title,
  who,
  needsAnswer,
  aside,
  children,
}: {
  title: string;
  who: string;
  needsAnswer?: number;
  aside?: ReactNode;
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
            <SignOut />
          </div>
          {aside}
        </header>
        <main>{children}</main>
      </div>
      <TabBar needsAnswer={needsAnswer} />
    </>
  );
}
