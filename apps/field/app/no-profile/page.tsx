import { SignOut } from '@/components/sign-out';

export default function NoProfile() {
  return (
    <div className="shell">
      <main>
        <div className="panel">
          <h2>Signed in, but not set up yet</h2>
          <p className="sub">
            Your login works. There is no staff record attached to it, so there is nothing to show
            you yet — someone in the office needs to add you and give you a role.
          </p>
          <SignOut />
        </div>
      </main>
    </div>
  );
}
