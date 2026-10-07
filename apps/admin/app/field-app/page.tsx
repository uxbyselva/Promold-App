import { requireSession } from '@/lib/session';
import { OfficeShell } from '@/components/office-shell';

export const dynamic = 'force-dynamic';

/**
 * Where the crew's app lives.
 *
 * The office app and the field app are two deployments of one database. This
 * page exists so nobody has to remember the other URL, and so the "add it to
 * your home screen" instructions are somewhere findable when a new starter
 * needs them.
 */
export default async function FieldAppPage() {
  const session = await requireSession();
  const url = process.env.NEXT_PUBLIC_FIELD_APP_URL ?? null;

  return (
    <OfficeShell session={session} mode="office">
      <div className="page-head">
        <div>
          <h1>The crew&rsquo;s app</h1>
          <p>
            A separate app at its own address, built for a phone: their jobs, their mileage, their
            time off. Same database, same rules — a crew lead simply cannot see a price, because the
            column never reaches their phone.
          </p>
        </div>
      </div>

      <div className="box">
        <header>
          <h3>Giving it to someone</h3>
        </header>
        <div className="body">
          {url ? (
            <p>
              Send them <a href={url}>{url}</a>.
            </p>
          ) : (
            <p className="note">
              The field app&rsquo;s address is not set here yet. Add{' '}
              <code>NEXT_PUBLIC_FIELD_APP_URL</code> to this app&rsquo;s environment variables in
              Vercel and redeploy, and the link will appear on this page.
            </p>
          )}

          <ol className="sub" style={{ lineHeight: 1.8, paddingLeft: 20 }}>
            <li>They open the link on their phone, and sign in with their work email.</li>
            <li>
              <b>iPhone:</b> Share → Add to Home Screen. <b>Android:</b> the menu → Install app.
            </li>
            <li>
              It then opens full-screen with its own icon, like any other app. No App Store, no
              install approval, and no update to chase — a fix is live the next time they open it.
            </li>
          </ol>

          <p className="hint">
            Worth doing the home-screen step with them rather than telling them about it: on an
            iPhone, notifications only work once it is there.
          </p>
        </div>
      </div>
    </OfficeShell>
  );
}
