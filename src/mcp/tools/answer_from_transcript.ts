import OpenAI from "openai";
import type { Env } from "../../env";
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "../../embeddings";
import { DEFAULT_MODEL } from "../../extract";
import type { ToolResult } from "./recent_calls";

export interface AnswerFromTranscriptInput {
  video_id: string;
  question: string;
}

export interface AnswerFromTranscriptDeps {
  openai?: OpenAI;
  vectorize?: VectorizeIndex;
  retries?: number;
  retryDelayMs?: number;
}

interface TranscriptRow {
  id: number;
  raw_text: string | null;
  title: string;
}

const TOP_K = 8;
const RAW_TEXT_FALLBACK_MAX = 24_000;

const SYSTEM_PROMPT = `You answer questions about a single meeting using only the provided transcript excerpts. Quote or paraphrase specifics from the excerpts when relevant. If the excerpts don't contain the answer, say so plainly — do not invent details.`;

function buildUserMessage(title: string, excerpts: string[], question: string): string {
  const joined = excerpts.map((e, i) => `[excerpt ${i + 1}]\n${e}`).join("\n\n---\n\n");
  return `Meeting: ${title}

Transcript excerpts:
${joined}

Question: ${question}`;
}

export async function answerFromTranscript(
  input: AnswerFromTranscriptInput,
  env: Env,
  deps: AnswerFromTranscriptDeps = {},
): Promise<ToolResult> {
  const openai = deps.openai ?? new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const vectorize = deps.vectorize ?? env.VECTORIZE;
  const retries = deps.retries ?? 3;
  const retryDelayMs = deps.retryDelayMs ?? 500;

  const row = await env.DB
    .prepare("SELECT id, raw_text, title FROM transcripts WHERE video_id = ?1")
    .bind(input.video_id)
    .first<TranscriptRow>();

  if (!row) {
    return {
      content: [
        { type: "text", text: `Call not found: \`${input.video_id}\`` },
      ],
    };
  }

  const embedResp = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: input.question,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const queryVector = embedResp.data[0].embedding;

  const queryResult = await vectorize.query(queryVector, {
    topK: TOP_K,
    returnMetadata: "all",
    filter: { transcript_id: row.id },
  });

  let excerpts: string[] = (queryResult.matches ?? [])
    .map((m) => String((m.metadata as { chunk_text?: unknown })?.chunk_text ?? ""))
    .filter((t) => t.length > 0);

  if (excerpts.length === 0) {
    // Vectorize is eventually consistent; fall back to the full raw transcript
    // stored in D1 when the index hasn't caught up (or the vector filter missed).
    if (row.raw_text && row.raw_text.length > 0) {
      excerpts = [row.raw_text.slice(0, RAW_TEXT_FALLBACK_MAX)];
    } else {
      return {
        content: [
          {
            type: "text",
            text: "Transcript not yet indexed — try again in a moment.",
          },
        ],
      };
    }
  }

  const userMessage = buildUserMessage(row.title, excerpts, input.question);

  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await openai.chat.completions.create({
        model: env.OPENAI_EXTRACTION_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      });
      const answer = resp.choices[0]?.message?.content ?? "";
      return {
        content: [{ type: "text", text: answer }],
      };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      const retryable = status === undefined || status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}
