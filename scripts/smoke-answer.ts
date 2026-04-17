/**
 * Smoke test for the `answer_from_transcript` MCP tool. Runs a canned eval
 * set of (video_id, question, expected_keywords) tuples against production
 * and asserts keywords appear in the model's answer.
 *
 * Skip CI — this uses real API keys + live data.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... \
 *   CLOUDFLARE_ACCOUNT_ID=... \
 *   CLOUDFLARE_API_TOKEN=... \
 *   npx tsx scripts/smoke-answer.ts
 *
 * Or smoke a specific case:
 *   ... scripts/smoke-answer.ts --case=1
 *
 * Because the MCP tool depends on CF D1 + Vectorize bindings, this script
 * reuses the deployed worker via MCP over HTTP rather than running the tool
 * locally. Simpler than stubbing bindings.
 */
import { readFileSync } from "node:fs";

const WORKER_URL = process.env.WORKER_URL ?? "https://aftercall.jeremy-chu.workers.dev";
const BEARER = process.env.MCP_BEARER_TOKEN;

if (!BEARER) {
  console.error(
    "Missing MCP_BEARER_TOKEN. Get one by completing the OAuth flow via Claude.ai,\n" +
      "then inspect KV via `wrangler kv key list --binding OAUTH_KV` and pluck the token.",
  );
  process.exit(1);
}

interface Case {
  name: string;
  video_id: string;
  question: string;
  expected_keywords: string[];
}

// Edit these to match real calls in your D1 before running.
const CASES: Case[] = [
  {
    name: "IT Hiring — compensation discussion",
    video_id: "meet.google.com/ahn-mfrm-hfm",
    question: "What starting compensation was discussed for Jugoslav?",
    expected_keywords: ["1,750", "USD"],
  },
  {
    name: "IT Hiring — start date",
    video_id: "meet.google.com/ahn-mfrm-hfm",
    question: "When does Jugoslav want to start?",
    expected_keywords: ["Wednesday"],
  },
];

async function callTool(videoId: string, question: string): Promise<string> {
  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "answer_from_transcript",
      arguments: { video_id: videoId, question },
    },
  };

  const resp = await fetch(`${WORKER_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${BEARER}`,
    },
    body: JSON.stringify(rpc),
  });

  if (!resp.ok) {
    throw new Error(`MCP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const body = (await resp.json()) as {
    result?: { content: Array<{ type: string; text: string }> };
    error?: { message: string };
  };
  if (body.error) throw new Error(`MCP error: ${body.error.message}`);
  return body.result?.content?.[0]?.text ?? "";
}

async function main(): Promise<void> {
  const caseArg = process.argv.find((a) => a.startsWith("--case="))?.split("=")[1];
  const toRun = caseArg
    ? [CASES[Number(caseArg) - 1]].filter(Boolean)
    : CASES;

  let passed = 0;
  let failed = 0;

  for (const c of toRun) {
    console.log(`\n→ ${c.name}`);
    console.log(`  Q: ${c.question}`);
    try {
      const answer = await callTool(c.video_id, c.question);
      console.log(`  A: ${answer.slice(0, 200)}${answer.length > 200 ? "…" : ""}`);
      const missing = c.expected_keywords.filter(
        (kw) => !answer.toLowerCase().includes(kw.toLowerCase()),
      );
      if (missing.length > 0) {
        console.log(`  ✗ Missing keywords: ${missing.join(", ")}`);
        failed++;
      } else {
        console.log(`  ✓ All keywords present`);
        passed++;
      }
    } catch (err) {
      console.error(`  ✗ ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n--- ${passed}/${toRun.length} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
