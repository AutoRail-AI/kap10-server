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
8.5. [Ollama setup (optional — local LLM inference)](#85-ollama-setup-optional--local-llm-inference)
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

4. **Repository permissions** (required for repo selection during install)
   - **Contents:** Read-only  
   - **Metadata:** Read-only  
   - **Pull requests:** Read and write  
   - **Webhooks:** Read and write (if webhook is active)
   - GitHub shows “Select repositories” or “All repositories” during install only if the app has at least one repository permission. Without these, the install may complete without letting you pick repos.

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

## 8.5 Ollama setup (optional — local LLM inference)

Ollama enables **free, unlimited local LLM inference** for the justification pipeline (Phase 4). It runs natively on macOS — **not** through Docker — and uses your Mac's Metal GPU for acceleration.

### 8.5.1 Install Ollama

```bash
brew install ollama
```

### 8.5.2 Start the server

```bash
ollama serve
```

This starts the Ollama API on `http://localhost:11434`. Leave this running in a terminal.

### 8.5.3 Pull models

In a **separate terminal**, pull the models you need:

```bash
# Standard model — good for most justification tasks (~5GB, needs ~6GB RAM)
ollama pull qwen3:8b

# Premium model — better quality for complex entities (~18GB, needs ~20GB RAM)
ollama pull qwen3-coder

# Embedding model (if you want local embeddings too)
ollama pull nomic-embed-text
```

**Recommended models for justification:**

| Model | Size | Context | Best for |
|-------|------|---------|----------|
| `qwen3:8b` | 5.2GB | 40K | Default — fast, good structured output |
| `qwen3-coder` | 18GB | 256K | Premium tier — best code understanding |

**Note:** Qwen3 models support **structured JSON output** (via Ollama's OpenAI-compatible `response_format`), **tool calling**, and **thinking mode**. The Vercel AI SDK's `generateObject()` works through the OpenAI-compatible `/v1/chat/completions` endpoint.

### 8.5.4 Configure environment

Set in `.env.local`:

```bash
LLM_PROVIDER=ollama
# OLLAMA_BASE_URL=http://localhost:11434/v1   # default, only change if non-standard
```

No API keys needed. Rate limiting is automatically disabled (local = unlimited).

### 8.5.5 Verify Ollama is working

```bash
# Check available models
curl http://localhost:11434/v1/models

# Test structured output
curl -X POST http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:8b",
    "messages": [{"role": "user", "content": "Return JSON: {\"name\": \"test\", \"value\": 42}"}],
    "response_format": {"type": "json_object"}
  }'
```

### 8.5.6 Run justification with Ollama

```bash
# Terminal 1: ollama serve (already running)
# Terminal 2: infrastructure
docker compose up -d

# Terminal 3: light worker with Ollama
LLM_PROVIDER=ollama pnpm temporal:worker:light

# Terminal 4: app
pnpm dev
```

Then trigger indexing on a repo — the justification phase will use Ollama instead of Gemini.

### 8.5.7 Provider comparison

| Provider | Setup | Rate Limits | Cost | Quality |
|----------|-------|-------------|------|---------|
| **Google Gemini** (default) | `GEMINI_API_KEY` | 15 RPM free tier | Free tier, then ~$0.10/1M input | Excellent |
| **Ollama (qwen3:8b)** | `brew install ollama` | Unlimited | $0 (runs on your GPU) | Good |
| **Ollama (qwen3-coder)** | Same | Unlimited | $0 | Very good for code |
| **OpenAI** | `OPENAI_API_KEY` | 500 RPM free | ~$0.15/1M input | Excellent |

For heavy batch workloads (full-repo justification), Ollama or OpenAI are better choices than Gemini's free tier due to rate limits.

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

### Cannot select repositories during GitHub App install

- Ensure the app has **at least one repository permission** (e.g. **Contents: Read-only**, **Metadata: Read-only**) in the app’s **Permissions and events** → **Repository permissions**. Without these, GitHub may not show the repository selection step.
- Ensure your GitHub account (or the org you’re installing into) **has at least one repository**. If there are no repos, there is nothing to select.
- If the install page only offers “Install” with no repo list, try: GitHub → **Settings** → **Applications** → **Installed GitHub Apps** → find your app → **Configure** → you can change “Only select repositories” and add/remove repos there after install.

### Callback fails with `?error=callback_failed` or “Cannot read properties of undefined (reading 'bind')”

- Confirm `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set in `.env.local` and the private key is valid (full PEM including `-----BEGIN ... KEY-----` and `-----END ... KEY-----`; if using a single line, use `\n` for newlines).
- Restart the dev server after changing env vars so the Octokit client picks them up.

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

### Ollama: "Connection refused" or model not found

- Ensure `ollama serve` is running in a terminal.
- Verify the model is pulled: `ollama list` should show `qwen3:8b` (or whichever model you configured).
- Check the endpoint: `curl http://localhost:11434/v1/models` should return a JSON list.
- If using a non-default port, set `OLLAMA_BASE_URL` in `.env.local`.

### Gemini 429 "Resource exhausted" errors

- This means you hit Gemini's free-tier rate limit (15 RPM). The provider now retries with exponential backoff automatically.
- To reduce pressure: lower `LLM_RPM_LIMIT` (e.g. `LLM_RPM_LIMIT=10` for a safety margin), or switch to Ollama (`LLM_PROVIDER=ollama`) for unlimited local inference.
- For large repos, consider using OpenAI (`LLM_PROVIDER=openai`) which has 500 RPM on the free tier.

---

## Related docs

- [README](../README.md) — Project overview, commands, Docker profiles  
- [.env.example](../.env.example) — All environment variables with comments  
- [Phase 1 — GitHub Connect & Indexing](architecture/PHASE_1_GITHUB_CONNECT_AND_INDEXING.md) — GitHub App design and implementation tracker  
