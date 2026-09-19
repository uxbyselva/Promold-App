# Getting the app running

Two routes. Pick one.

| | Vercel (no terminal) | Your own machine |
|---|---|---|
| What you install | Nothing | Node.js, pnpm, Git |
| How you open it | A web address, from any device | `localhost:3000`, only that computer |
| Who can see it | Anyone you give the link to | Only you |
| Updates | Automatic on every push | You pull and restart |

**Vercel is the right choice unless you already work in a terminal.** It is
free for this, your crew can open it on their phones, and there is nothing to
install.

---

# Route A — Vercel

## 1. Sign in

Go to [vercel.com](https://vercel.com) → **Sign Up** → **Continue with
GitHub**. Use the same GitHub account that owns the repository.

## 2. Import the repository

1. **Add New…** → **Project**
2. Find **Promold-App** in the list → **Import**
   - If it is not listed, click **Adjust GitHub App Permissions** and grant
     access to that repository.

## 3. Configure it

Three settings on the import screen. The first one matters most.

| Setting | Value |
|---|---|
| **Root Directory** | Click **Edit** and choose `apps/admin` |
| **Framework Preset** | **Next.js** — check this, do not assume |
| **Output Directory** | Leave empty. Next.js handles it. |
| **Environment Variables** | The two below |

> **"No Output Directory named 'public' found"** means the Framework Preset is
> not Next.js, or the Root Directory is not `apps/admin`. Vercel has fallen
> back to treating the repository as a plain static site and gone looking for
> a folder of HTML files. Fix both settings and redeploy.

Environment variables:

```
NEXT_PUBLIC_SUPABASE_URL      https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY eyJ... (the anon key, not service_role)
```

Both come from Supabase → **Project Settings → API**. Vercel stores them
encrypted; they are not in the repository.

## 4. Deploy

Click **Deploy** and wait a couple of minutes. You get a web address ending
`.vercel.app`. Open it, sign in with the user you created in Supabase, and
you are on the dispatch board.

## 5. Point it at the right branch

The work is on a branch, not `main`, so tell Vercel which to treat as live:

**Project Settings → Git → Production Branch** →
`claude/contractor-app-planning-jf5e7v` → **Save**, then redeploy from the
**Deployments** tab.

Alternatively, merge that branch into `main` and skip this step. From then on,
every push deploys by itself.

---

# Route B — your own machine

Only if you want to work on the code locally.

### Install first

**Mac** — open Terminal (Cmd+Space, type "Terminal"):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node git
npm install -g pnpm
```

**Windows** — install [Node.js LTS](https://nodejs.org) and
[Git for Windows](https://git-scm.com/download/win), then open **PowerShell**:

```powershell
npm install -g pnpm
```

### Then

```bash
git clone https://github.com/uxbyselva/Promold-App.git
cd Promold-App
git checkout claude/contractor-app-planning-jf5e7v
pnpm install
```

Create `apps/admin/.env.local` in a text editor with the two lines from step 3
above, then:

```bash
pnpm --filter @promold/admin dev
```

Open http://localhost:3000. Stop it with Ctrl+C.

---

# The crew's app — a second project

There are two apps: **the office** (`apps/admin`) and **the crew's**
(`apps/field`). They share one database and one repository, and each gets its
own Vercel project and its own web address. You do the import twice.

## Set it up

Repeat **Route A** from the top with two things changed:

| Setting | Value |
|---|---|
| **Root Directory** | `apps/field` — not `apps/admin` |
| **Project Name** | Something like `promold-field`, so the address differs |

Everything else is identical: Framework Preset **Next.js**, the same two
environment variables, the same branch.

Then go back to the **office** project and add one more variable so it can
show the crew's link on its own "Crew app" page:

```
NEXT_PUBLIC_FIELD_APP_URL   https://promold-field.vercel.app
```

Redeploy the office project after adding it — environment variables are read
at build time, so an existing deployment will not pick it up.

## Give it to the crew

Send one person the field app's address and do this with them once, on their
phone:

1. Open the link and sign in with their work email.
2. **iPhone:** the Share button → **Add to Home Screen**.
   **Android:** the ⋮ menu → **Install app**.
3. It now has its own icon and opens full-screen, like any other app.

No App Store, no Play Store, no developer account, nothing to approve. When a
fix is pushed, they have it the next time they open it — there is no update to
chase.

The one thing worth doing rather than explaining: on an iPhone, notifications
only work once it is on the home screen. Do step 2 with them.

---

# One-time database setup

Some things are not migrations and have to be run once by hand, in Supabase →
**SQL Editor**.

| File | What it does | When |
|---|---|---|
| `supabase/bootstrap.sql` | Builds the whole schema | First time only |
| `supabase/storage.sql` | Creates the private bucket job photos go in | Before the crew take any |

If a migration has been added since you last ran `bootstrap.sql`, run the new
numbered file from `supabase/migrations/` on its own rather than re-running
the whole bootstrap.

Until `storage.sql` has been run, the photo galleries in the field app say so
plainly rather than failing in a way nobody can diagnose.

---

# Either way, when you first open it

**"No profile for this login"** — you signed in, but step 4 of
[SUPABASE-SETUP.md](SUPABASE-SETUP.md) has not been run for your email. Row
level security scopes every table to your organisation, and without that row
you belong to none. Run step 4 and reload.

**An empty board** — no jobs on today's date. Use the arrows either side of
the date, or load the demo data and go to 18 September 2026.

**"NEXT_PUBLIC_SUPABASE_URL is not set"** — the environment variables did not
reach the build. On Vercel, check Project Settings → Environment Variables and
redeploy; they are only read at build time.

---

# A note for whoever maintains this

`NEXT_PUBLIC_*` variables are inlined into the browser bundle by **text
substitution at build time**. That only works on a literal reference:

```ts
process.env.NEXT_PUBLIC_SUPABASE_URL   // substituted — works
process.env[name]                      // not substituted — always undefined
```

The second form cost hours once. The app reported missing configuration on a
deployment whose variables were set correctly, which sent everyone looking at
the dashboard instead of the code. If you add a variable, reference it
literally, and check it survives the build:

```bash
pnpm --filter @promold/admin build
grep -rl "your-project-ref" apps/admin/.next/static   # should find it
```
