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
| **Framework Preset** | Next.js — it should detect this by itself |
| **Environment Variables** | The two below |

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
