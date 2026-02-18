# Kap10 — Local Development Setup

Step-by-step guide to run the full Kap10 platform on your machine: infrastructure, app, GitHub App (repo indexing), and optional workers.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone and install](#2-clone-and-install)
3. [Environment configuration](#3-environment-configuration)
4. [Supabase setup](#4-supabase-setup)
5. [GitHub App setup (repository indexing)](#5-github-app-setup-repository-indexing)
6. [Run infrastructure](#6-run-infrastructure)
7. [Run the application](#7-run-the-application)
8. [Run Temporal workers (optional)](#8-run-temporal-workers-optional)
9. [Verify everything works](#9-verify-everything-works)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

- **Node.js** >= 20.9.0  
  Check: `node --version`
- **pnpm** (via Corepack)  
  Enable: `corepack enable`  
  Check: `pnpm --version`
- **Docker & Docker Compose**  
  Check: `docker compose version`
- **Git**
- A **Supabase** account (free tier is fine) for app data and auth
- A **GitHub** account (for creating the GitHub App used for repo indexing)

---

## 2. Clone and install

```bash
git clone <your-repo-url>
cd kap10-server
pnpm install
```

---

## 3. Environment configuration

Create your local env file from the example:

```bash
cp .env.example .env.local
```

You will fill in values in the next steps. Minimum for the app to start:

- Supabase: `SUPABASE_DB_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- Better Auth: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://localhost:3000`
- Infrastructure (used when Docker is running): `REDIS_URL`, `ARANGODB_*`, `TEMPORAL_ADDRESS`

For **repository indexing (Phase 1)** you also need the GitHub App credentials from [§5](#5-github-app-setup-repository-indexing).

---

## 4. Supabase setup

1. Go to [Supabase Dashboard](https://supabase.com/dashboard) and create a new project (or use an existing one).
2. In the project:
   - **Settings → API:** copy **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`, and **publishable** key → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   - **Settings → API:** copy **service_role** (secret) key → `SUPABASE_SECRET_KEY`.
   - **Settings → Database:** under **Connection string**, choose **URI** and copy the connection string. Replace `[YOUR-PASSWORD]` with your database password → `SUPABASE_DB_URL`.
3. Put all four values into `.env.local`.

Generate a secret for Better Auth (at least 32 characters):

```bash
openssl rand -base64 32
```

Set in `.env.local`:

```bash
BETTER_AUTH_SECRET=<paste-the-output>
BETTER_AUTH_URL=http://localhost:3000
```

---

## 5. GitHub App setup (repository indexing)

The GitHub App is used for **connecting repositories and indexing** (Phase 1). It is separate from GitHub OAuth (which is used only for user login).

### 5.1 Create the GitHub App

1. Open **[Create new GitHub App](https://github.com/settings/apps/new)**  
   (Or: GitHub → **Settings** → **Developer settings** → **GitHub Apps** → **New GitHub App**.)

2. **Basic information**
   - **GitHub App name:** e.g. `kap10-local` or `kap10-dev` (this becomes the URL slug).
   - **Homepage URL:** `http://localhost:3000` (must match `BETTER_AUTH_URL`).
   - **Callback URL:**  
     `http://localhost:3000/api/github/callback`

3. **Webhook (optional for local dev)**
   - **Active:** Uncheck if you are not using a tunnel (GitHub cannot reach `localhost`). You can enable it later with ngrok.
   - If you enable it:
     - **Webhook URL:** `http://localhost:3000/api/webhooks/github` (or your ngrok URL).
     - **Webhook secret:** Generate with `openssl rand -hex 32` and set the same value in GitHub and in `.env.local` as `GITHUB_WEBHOOK_SECRET`.

4. **Repository permissions**
   - **Contents:** Read-only  
   - **Metadata:** Read-only  
   - **Pull requests:** Read and write  
   - **Webhooks:** Read and write (if webhook is active)

5. **Subscribe to events**
   - `push`, `pull_request`, `installation`, `installation_repositories`

6. **Where can this GitHub App be installed?**
   - **Only on this account** for personal dev, or **Any account** if you want to install on orgs.

7. Click **Create GitHub App**.

### 5.2 Get the GitHub App credentials

After creating the app you land on its **General** page.

1. **App ID (numeric)**  
   Shown at the top. Copy it → in `.env.local` set:
   ```bash
   GITHUB_APP_ID=123456
   ```
   (Use your actual number.)

2. **Private key (PEM)**  
   - In the left sidebar click **Private keys**.
   - Click **Generate a private key** and download the `.pem` file.
   - Open the file and copy the entire contents (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`).
   - In `.env.local` set `GITHUB_APP_PRIVATE_KEY` in one of these ways:
     - **Multi-line** (if your env loader supports it):
       ```bash
       GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
       MIIEowIBAAKCAQEA...
       -----END RSA PRIVATE KEY-----"
       ```
     - **Single line** (escape newlines as `\n`):
       ```bash
       GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK...\n-----END RSA PRIVATE KEY-----"
       ```

3. **App slug (optional)**  
   The install URL is `https://github.com/apps/{slug}/installations/new`. The slug is your app name lowercased and hyphenated. If your app name is `kap10-local`, you can set:
   ```bash
   GITHUB_APP_SLUG=kap10-local
   ```
   If you don’t set this, the code defaults to `kap10-dev`.

4. **Webhook secret (if you enabled webhooks)**  
   Use the same value you put in the GitHub App **Webhook secret** field:
   ```bash
   GITHUB_WEBHOOK_SECRET=<your-secret>
   ```

### 5.3 Summary: GitHub App env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_APP_ID` | Yes | Numeric App ID from the app’s General page. |
| `GITHUB_APP_PRIVATE_KEY` | Yes | Full PEM private key (multi-line or single line with `\n`). |
| `GITHUB_APP_SLUG` | No | URL slug (e.g. `kap10-local`). Default: `kap10-dev`. |
| `GITHUB_WEBHOOK_SECRET` | If using webhooks | Same value as in GitHub App webhook settings. |

**Note:** The app uses **App ID + Private Key** to generate JWTs and obtain installation access tokens. It does **not** use the GitHub App’s “Client ID” or “Client secret” for repo indexing. See [Phase 1 doc — GitHub App](architecture/PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) for details.

---

## 6. Run infrastructure

Start Redis, ArangoDB, Temporal, and Temporal’s PostgreSQL (used only by Temporal, not app data):

```bash
docker compose up -d
```

Check that containers are running:

```bash
docker compose ps
```

You should see: `redis`, `arangodb`, `temporal`, `temporal-ui`, `postgresql`.

**Ports:**

| Service    | Port  | URL (from host)              |
|-----------|-------|------------------------------|
| Redis     | 6379  | `redis://localhost:6379`     |
| ArangoDB  | 8529  | http://localhost:8529       |
| Temporal  | 7233  | `localhost:7233` (gRPC)     |
| Temporal UI | 8080 | http://localhost:8080     |
| PostgreSQL (Temporal) | 5432 | localhost:5432 |

Ensure `.env.local` has:

```bash
REDIS_URL=redis://localhost:6379
ARANGODB_URL=http://localhost:8529
ARANGODB_DATABASE=kap10_db
ARANGO_ROOT_PASSWORD=firstPassword12345
TEMPORAL_ADDRESS=localhost:7233
```

(`ARANGO_ROOT_PASSWORD` should match the default in `docker-compose.yml` if you didn’t change it.)

---

## 7. Run the application

1. **Apply database migrations** (creates schema and tables; also runs automatically before `pnpm dev`):

   ```bash
   pnpm migrate
   ```

2. **Start the Next.js dev server:**

   ```bash
   pnpm dev
   ```

3. Open **http://localhost:3000** in your browser.

4. **First time:** Register or log in (email/password or OAuth if configured). Complete onboarding (create or select an organization). Then go to **Repositories** and click **Connect GitHub** — you should be redirected to GitHub to install the app and select repos.

---

## 8. Run Temporal workers (optional)

Repo indexing uses Temporal workflows. To run the workers on your machine (instead of in Docker):

1. **Heavy worker** (clone, SCIP, parse — run in one terminal):

   ```bash
   pnpm temporal:worker:heavy
   ```

2. **Light worker** (write to ArangoDB, delete repo data — run in another terminal):

   ```bash
   pnpm temporal:worker:light
   ```

Alternatively, run workers inside Docker:

```bash
docker compose --profile worker up -d
```

This starts `temporal-worker-heavy` and `temporal-worker-light` in addition to the infrastructure. Ensure `.env.local` is available to the app container if you use `docker compose --profile app` (see README).

---

## 9. Verify everything works

| Check | How |
|-------|-----|
| App loads | http://localhost:3000 |
| Health | http://localhost:3000/api/health (should report Redis, ArangoDB, Temporal) |
| Temporal UI | http://localhost:8080 |
| ArangoDB UI | http://localhost:8529 (login: `root`, password: from `ARANGO_ROOT_PASSWORD`) |
| Connect GitHub | Log in → Repositories → **Connect GitHub** → redirects to GitHub App install |
| List repos | After installing the app, **Add Repository** should list repos from GitHub |

---

## 10. Troubleshooting

### App won’t start: “GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required”

You’re calling code that needs the GitHub App (e.g. listing or connecting repos). Add both to `.env.local` as in [§5.2](#52-get-the-github-app-credentials). The app does **not** use Client ID / Client secret for this.

### “Connect GitHub” redirects to the wrong app

Set `GITHUB_APP_SLUG` in `.env.local` to the slug of your app (same as in the URL `https://github.com/apps/<slug>`). The slug is usually the app name in lowercase with hyphens (e.g. `kap10-local`).

### Migrations fail or schema errors

- Confirm `SUPABASE_DB_URL` is correct and the database is reachable.
- Run `pnpm migrate` again. If the schema already exists, migrations should be idempotent.

### Temporal workers not picking up workflows

- Ensure Temporal is running: `docker compose ps` and http://localhost:8080.
- Start both workers: `pnpm temporal:worker:heavy` and `pnpm temporal:worker:light` (or `docker compose --profile worker up -d`).
- In Temporal UI, check that workflows appear and that activities are registered on the correct task queues.

### Webhooks (e.g. installation_repositories) not received locally

GitHub cannot send webhooks to `localhost`. Either:

- Leave **Webhook** disabled for the GitHub App while developing locally, or  
- Use a tunnel (e.g. [ngrok](https://ngrok.com)) and set the GitHub App webhook URL to `https://your-ngrok-url/api/webhooks/github`, and set `BETTER_AUTH_URL` (or your app’s base URL) so redirects work.

### ArangoDB connection refused

- Start infrastructure: `docker compose up -d`.
- Check `ARANGODB_URL=http://localhost:8529` and that nothing else is using port 8529.

---

## Related docs

- [README](../README.md) — Project overview, commands, Docker profiles  
- [.env.example](../.env.example) — All environment variables with comments  
- [Phase 1 — GitHub Connect & Indexing](architecture/PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) — GitHub App design and implementation tracker  
