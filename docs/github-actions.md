# GitHub Actions CI/CD

This repository deploys the Cloudflare Worker from GitHub Actions when changes
land on `main`.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `CI/CD` | Pull requests to `main` | Installs dependencies, typechecks, and runs tests |
| `CI/CD` | Pushes to `main` or manual dispatch | Runs validation, generates `wrangler.toml`, dry-runs the Worker bundle, applies D1 migrations, and deploys |
| `Dependabot` | Weekly | Opens grouped dependency PRs for npm and GitHub Actions |

## Required Repository Secret

Set this in GitHub under **Settings -> Secrets and variables -> Actions -> Secrets**:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Authenticates Wrangler in CI. Use a Cloudflare API token scoped to the account that owns this Worker. |

Cloudflare's Workers GitHub Actions docs recommend using a CI API token plus
`CLOUDFLARE_ACCOUNT_ID` instead of interactive `wrangler login`.

## Required Repository Variables

Set these under **Settings -> Secrets and variables -> Actions -> Variables**:

| Variable | Example | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | `9df...502d` | Cloudflare account that owns the Worker |
| `CLOUDFLARE_WORKER_NAME` | `aftercall` | Worker script name |
| `CLOUDFLARE_D1_DATABASE_NAME` | `aftercall-db` | D1 database name for migrations |
| `CLOUDFLARE_D1_DATABASE_ID` | `2be...e1e` | D1 database ID for the `DB` binding |
| `CLOUDFLARE_VECTORIZE_INDEX_NAME` | `aftercall-vectors` | Vectorize index name |
| `CLOUDFLARE_KV_NAMESPACE_ID` | `60e...805` | KV namespace ID for OAuth state |
| `BASE_URL` | `https://aftercall.example.workers.dev` | Public Worker origin used by OAuth callbacks |
| `ALLOWED_USERS` | `palworth` | Comma-separated GitHub usernames allowed to use MCP |

Optional variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLOUDFLARE_COMPATIBILITY_DATE` | `2026-04-01` | Worker compatibility date |
| `OPENAI_EXTRACTION_MODEL` | `gpt-5-mini` | Structured extraction model |
| `NOTION_TRANSCRIPTS_DATA_SOURCE_ID` | empty | Notion transcripts data source |
| `NOTION_FOLLOWUPS_DATA_SOURCE_ID` | empty | Notion followups data source |
| `SENTRY_ENVIRONMENT` | `production` | Runtime Sentry environment var |

Optional secret:

| Secret | Purpose |
| --- | --- |
| `SENTRY_AUTH_TOKEN` | Enables source map upload during `npm run deploy` |

## Worker Runtime Secrets

GitHub Actions deploys the Worker code, but runtime secrets still live in
Cloudflare. Set them with Wrangler:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put BLUEDOT_WEBHOOK_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put NOTION_INTEGRATION_KEY
npx wrangler secret put SENTRY_DSN
```

`NOTION_INTEGRATION_KEY` and `SENTRY_DSN` are only needed when those integrations
are enabled.

## Deployment Order

On `main`, the deploy job:

1. Generates `wrangler.toml` from repository variables.
2. Runs `wrangler deploy --dry-run` to validate the bundle.
3. Applies remote D1 migrations.
4. Runs `npm run deploy`, which deploys the Worker and uploads Sentry source maps
   when Sentry is configured.
