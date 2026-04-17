/**
 * One-off Phase 2 migration — reinsert existing Vectorize chunks so they get
 * covered by the `transcript_id` metadata index.
 *
 * Cloudflare Vectorize metadata indexes only apply to vectors inserted AFTER
 * the index is created. Existing production vectors are invisible to
 * filtered queries (`filter: { transcript_id: N }`) until they're re-upserted.
 *
 * This script:
 *   1. Reads every transcripts row from D1 that has raw_text
 *   2. Re-chunks raw_text via embeddings.chunkTranscript
 *   3. Regenerates embeddings via OpenAI
 *   4. Re-upserts via wrangler vectorize insert (NDJSON format)
 *   5. IDs are deterministic ({transcriptId}-{chunkIndex}), so idempotent
 *
 * Cost: ~$0.00002/1k tokens × ~500 tokens/chunk × ~20 chunks/call × N calls.
 * For 50 calls ≈ $0.01.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx scripts/reindex-vectorize.ts
 *
 * Optional filter to a single call:
 *   ... scripts/reindex-vectorize.ts --video-id=meet.google.com/xyz-abc
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import OpenAI from "openai";
import { chunkTranscript, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../src/embeddings";

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const D1_NAME = "aftercall-db";
const VECTORIZE_NAME = "aftercall-vectors";
const METADATA_TEXT_MAX = 2048;

if (!OPENAI_KEY) {
  console.error("Missing OPENAI_API_KEY env var");
  process.exit(1);
}

const videoIdFilter = process.argv.find((a) => a.startsWith("--video-id="))?.split("=")[1];
const openai = new OpenAI({ apiKey: OPENAI_KEY });

interface TranscriptRow {
  id: number;
  video_id: string;
  title: string;
  raw_text: string | null;
}

function runCli(cmd: string, args: string[], input?: string): { stdout: string; status: number } {
  const r = spawnSync(cmd, args, { encoding: "utf8", input, maxBuffer: 50 * 1024 * 1024 });
  return { stdout: r.stdout, status: r.status ?? 1 };
}

function listTranscripts(): TranscriptRow[] {
  const where = videoIdFilter
    ? `WHERE video_id = '${videoIdFilter.replace(/'/g, "''")}' AND raw_text IS NOT NULL`
    : `WHERE raw_text IS NOT NULL`;
  const r = runCli("npx", [
    "wrangler",
    "d1",
    "execute",
    D1_NAME,
    "--remote",
    "--command",
    `SELECT id, video_id, title, raw_text FROM transcripts ${where}`,
    "--json",
  ]);
  if (r.status !== 0) {
    console.error("Failed to query D1:", r.stdout);
    process.exit(1);
  }
  const parsed = JSON.parse(r.stdout);
  return parsed[0]?.results ?? [];
}

async function reindexOne(row: TranscriptRow): Promise<number> {
  if (!row.raw_text) return 0;

  const chunks = chunkTranscript(row.raw_text, { maxTokens: 500, overlapTokens: 50 });
  if (chunks.length === 0) return 0;

  console.log(`  Embedding ${chunks.length} chunk(s)...`);
  const embResp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: chunks.map((c) => c.text),
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const vectors = embResp.data.map((d, i) => ({
    id: `${row.id}-${i}`,
    values: d.embedding,
    metadata: {
      transcript_id: row.id,
      chunk_index: i,
      chunk_text: chunks[i].text.slice(0, METADATA_TEXT_MAX),
    },
  }));

  const ndjson = vectors.map((v) => JSON.stringify(v)).join("\n");
  const tmpFile = `/tmp/reindex-${row.id}.ndjson`;
  writeFileSync(tmpFile, ndjson);
  const ins = runCli("npx", ["wrangler", "vectorize", "insert", VECTORIZE_NAME, "--file", tmpFile]);
  unlinkSync(tmpFile);
  if (ins.status !== 0) {
    console.error(`  ✗ wrangler vectorize insert failed:`, ins.stdout);
    return 0;
  }
  console.log(`  ✓ ${vectors.length} vector(s) upserted for transcript ${row.id}`);
  return vectors.length;
}

async function main(): Promise<void> {
  const rows = listTranscripts();
  console.log(`Found ${rows.length} transcript row(s)${videoIdFilter ? ` matching \`${videoIdFilter}\`` : ""}`);

  let totalVectors = 0;
  let failures = 0;
  for (const row of rows) {
    console.log(`\n→ [${row.id}] ${row.title.slice(0, 60)} (${row.video_id})`);
    try {
      totalVectors += await reindexOne(row);
    } catch (err) {
      failures++;
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`  Transcripts processed: ${rows.length}`);
  console.log(`  Total vectors upserted: ${totalVectors}`);
  console.log(`  Failures: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
