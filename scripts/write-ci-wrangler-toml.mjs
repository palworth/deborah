#!/usr/bin/env node
/**
 * Generate wrangler.toml in CI from GitHub repository variables.
 *
 * The real wrangler.toml is intentionally gitignored because it contains
 * workspace-specific Cloudflare resource IDs. GitHub Actions can recreate it
 * just before validation/deploy without committing those IDs.
 */
import { writeFileSync } from "node:fs";

const required = [
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_KV_NAMESPACE_ID",
  "BASE_URL",
  "ALLOWED_USERS",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  for (const name of missing) {
    console.error(`::error::Missing required environment variable ${name}`);
  }
  process.exit(1);
}

const config = {
  workerName: env("CLOUDFLARE_WORKER_NAME", "aftercall"),
  compatibilityDate: env("CLOUDFLARE_COMPATIBILITY_DATE", "2026-04-01"),
  openaiExtractionModel: env("OPENAI_EXTRACTION_MODEL", "gpt-5-mini"),
  notionTranscriptsDataSourceId: env("NOTION_TRANSCRIPTS_DATA_SOURCE_ID", ""),
  notionFollowupsDataSourceId: env("NOTION_FOLLOWUPS_DATA_SOURCE_ID", ""),
  baseUrl: requiredEnv("BASE_URL"),
  allowedUsers: requiredEnv("ALLOWED_USERS"),
  sentryEnvironment: env("SENTRY_ENVIRONMENT", "production"),
  d1DatabaseName: env("CLOUDFLARE_D1_DATABASE_NAME", "aftercall-db"),
  d1DatabaseId: requiredEnv("CLOUDFLARE_D1_DATABASE_ID"),
  vectorizeIndexName: env("CLOUDFLARE_VECTORIZE_INDEX_NAME", "aftercall-vectors"),
  kvNamespaceId: requiredEnv("CLOUDFLARE_KV_NAMESPACE_ID"),
};

const toml = `name = ${tomlString(config.workerName)}
main = "src/index.ts"
compatibility_date = ${tomlString(config.compatibilityDate)}
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[vars]
OPENAI_EXTRACTION_MODEL = ${tomlString(config.openaiExtractionModel)}
NOTION_TRANSCRIPTS_DATA_SOURCE_ID = ${tomlString(config.notionTranscriptsDataSourceId)}
NOTION_FOLLOWUPS_DATA_SOURCE_ID = ${tomlString(config.notionFollowupsDataSourceId)}
BASE_URL = ${tomlString(config.baseUrl)}
ALLOWED_USERS = ${tomlString(config.allowedUsers)}
SENTRY_ENVIRONMENT = ${tomlString(config.sentryEnvironment)}

[[d1_databases]]
binding = "DB"
database_name = ${tomlString(config.d1DatabaseName)}
database_id = ${tomlString(config.d1DatabaseId)}
migrations_dir = "drizzle"

[[vectorize]]
binding = "VECTORIZE"
index_name = ${tomlString(config.vectorizeIndexName)}
remote = true

[[kv_namespaces]]
binding = "OAUTH_KV"
id = ${tomlString(config.kvNamespaceId)}

[observability]
enabled = true
`;

writeFileSync("wrangler.toml", toml, "utf8");
console.log(`Generated wrangler.toml for Worker ${config.workerName}`);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function env(name, fallback) {
  const value = process.env[name];
  return value == null || value === "" ? fallback : value;
}

function tomlString(value) {
  return JSON.stringify(value);
}
