# Running ORIN against a local Supabase

25 November 2026

This guide runs the whole Supabase backend (database, sign-in and file storage) in Docker on your own computer. Your local data is separate from the hosted project and from your teammates' data. Nothing you do locally changes the hosted database.

Use it for development and testing. Release builds keep using the hosted project (see [Releases](#releases)).

## What you need

| Tool | Notes |
| --- | --- |
| Docker Desktop | It must be running while you use the local stack. |
| Supabase CLI | Tested with version 2.84.2. |
| Node.js and pnpm | The versions you already use for `pnpm dev`. |

## 1. Install the Supabase CLI

macOS:

```bash
brew install supabase/tap/supabase
```

Windows (PowerShell, with [Scoop](https://scoop.sh)):

```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

Check that it works:

```bash
supabase --version
```

## 2. Get the latest code

```bash
git pull
pnpm install
```

## 3. Start the local stack and point the app at it

Start Docker Desktop, then run this from the repository root:

```bash
pnpm supabase:local
```

This command does the following:

- Starts Supabase in Docker and applies every migration in `supabase/migrations/`. The first start downloads the images and takes a few minutes.
- Saves your current Supabase settings from `.env` in `.env.hosted.local`, so you can switch back later. Git ignores this file.
- Sets these four settings in `.env` to the local stack: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The script leaves every other line in `.env` alone.
- Creates a `CENTINEL_TOKEN_ENCRYPTION_KEY` only if yours is empty.

The script never prints key values, and it never writes a service-role key.

## 4. Run the app

```bash
pnpm dev
```

If `pnpm dev` was already running, stop it and start it again. The sidecar reads `.env` only when it starts.

## 5. Create your local account

The local database starts empty, so your hosted account does not exist there.

1. On the sign-in screen, choose **Create an account**. Any email works, and the password needs at least 8 characters.
2. Choose **Create account**. Email confirmation is turned off locally, so you are signed in right away.
3. Local email (for example, password reset) never leaves your computer. Read it at http://127.0.0.1:54324.

## 6. Set up your account again

Settings are saved per account in the database, so a new local account starts with none:

- **Model Provider and embeddings:** open Settings and enter your provider and API key again.
- **Projects:** create them again. For example, add the folder `examples/sample-shop` and run a full check.
- **GitHub, Google Drive and Slack:** connect them again only if you need them. They use the same OAuth settings from `.env` as before.

## Everyday commands

| What you want | Command |
| --- | --- |
| Start the stack after a restart | `pnpm supabase:local` |
| Point `.env` at a stack that is already running | `pnpm supabase:local:env` |
| Apply new migrations after `git pull`, keeping your data | `supabase migration up` |
| Look at tables and storage in a browser | http://127.0.0.1:54323 (Supabase Studio) |
| Stop the stack and keep your data | `supabase stop` |
| Wipe all local data and re-run every migration | `supabase db reset` |
| Switch back to the hosted project | `pnpm supabase:hosted`, then restart `pnpm dev` |

## Problems

- **`supabase start` fails with a Docker error.** Docker Desktop is not running, or it is still starting. Wait until it says it is running, then try again.
- **A port is already in use (54321–54324).** Another Supabase project is running on your computer. Run `supabase stop --project-id <other project>` in that project, or stop its containers in Docker Desktop.
- **The storage container keeps restarting.** The script pins the storage image to `v1.89.13` in `supabase/.temp/storage-version`. Delete that file, run `pnpm supabase:local` again, and say which CLI version you have.
- **The app still uses the hosted project.** Restart `pnpm dev`. To check, look at the bottom-left account: a local account is the one you created in step 5.
- **"Invalid login credentials".** Accounts from the hosted project do not exist locally. Sign up again (step 5).
- **Provider settings cannot be saved.** `CENTINEL_TOKEN_ENCRYPTION_KEY` is empty in `.env`. Run `pnpm supabase:local:env`, which fills it in, then restart `pnpm dev`.

## Rules

- Never commit `.env`, `.env.hosted.local` or `.env.production.local`. Git already ignores them.
- Never put a service-role key in `.env`. The desktop app and sidecar must not use one, including the local one.
- A new migration goes in `supabase/migrations/`. Test it locally with `supabase migration up`. Applying it to the hosted project is a separate, explicit step.

## Releases

Release builds use the hosted project. `scripts/bundle-sidecar.mjs` and the Vite production build read the git-ignored `.env.production.local` before `.env`. Keep only the hosted URL and anon key there.

## Copying hosted data into the local stack

If you need your hosted projects locally, follow "Local Supabase for development" in [SUPABASE_SETUP.md](SUPABASE_SETUP.md). It needs access to the hosted project, and users sign in again afterwards.
