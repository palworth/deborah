/**
 * MCP server scaffold — registers aftercall tools on an McpServer
 * instance, wires it through the Streamable HTTP transport.
 *
 * Stateless mode (sessionIdGenerator undefined): every /mcp request is
 * self-contained. This also sidesteps the `Mcp-Session-Id` coordination
 * concerns from Phase 1 Task 1.12.
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Env } from "../env";
import { searchCalls } from "./tools/search_calls";
import { getCall } from "./tools/get_call";
import { listFollowups } from "./tools/list_followups";
import { findActionItemsFor } from "./tools/find_action_items_for";
import { recentCalls } from "./tools/recent_calls";
import { answerFromTranscript } from "./tools/answer_from_transcript";
import { listMeetings } from "./tools/list_meetings";
import { listCommitments } from "./tools/list_commitments";

export function createMcpServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "aftercall", version: "0.6.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "search_calls",
    {
      title: "Search calls",
      description:
        "Semantic search across indexed Bluedot call transcripts. Returns the top matching calls by vector similarity, one line per call, with a snippet and relevance score.",
      inputSchema: {
        query: z.string().min(1).describe("Natural-language query to search for."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(25)
          .optional()
          .describe("Max number of calls to return (default 5, max 25)."),
      },
    },
    async (args) => (await searchCalls(args, env)) as any,
  );

  server.registerTool(
    "get_call",
    {
      title: "Get call",
      description:
        "Fetch a single call transcript's full details (title, summary, participants, action items) by its video ID.",
      inputSchema: {
        video_id: z
          .string()
          .min(1)
          .describe("The video_id of the call (e.g. `https://meet.google.com/abc-xyz`)."),
      },
    },
    async (args) => (await getCall(args, env)) as any,
  );

  server.registerTool(
    "list_followups",
    {
      title: "List followups",
      description:
        "Query the Notion Followups database. Supports filtering by status (e.g. Inbox, In Progress, Done) and by source (e.g. Bluedot).",
      inputSchema: {
        status: z.string().optional().describe("Filter by Status select value."),
        source: z.string().optional().describe("Filter by Source select value."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max rows to return (default 25, max 100)."),
      },
    },
    async (args) => (await listFollowups(args, env)) as any,
  );

  server.registerTool(
    "find_action_items_for",
    {
      title: "Find action items for a person",
      description:
        "Find action items assigned to a specific person across all indexed calls. Case-insensitive substring match on the owner field.",
      inputSchema: {
        person: z
          .string()
          .min(1)
          .describe("Name (or substring) of the action-item owner."),
        since: z
          .string()
          .optional()
          .describe("ISO date (YYYY-MM-DD) lower bound on call creation date."),
      },
    },
    async (args) => (await findActionItemsFor(args, env)) as any,
  );

  server.registerTool(
    "answer_from_transcript",
    {
      title: "Answer from transcript",
      description:
        "Ask a question about a specific call. Runs RAG over that call's transcript chunks (via Vectorize) and returns a grounded answer. Use this for 'when did we discuss X in this call?' or 'what did Y say about Z?' style queries against a single meeting.",
      inputSchema: {
        video_id: z
          .string()
          .min(1)
          .describe("The video_id of the call (e.g. `https://meet.google.com/abc-xyz`)."),
        question: z
          .string()
          .min(1)
          .describe("The natural-language question to answer from this transcript."),
      },
    },
    async (args) => (await answerFromTranscript(args, env)) as any,
  );

  server.registerTool(
    "list_meetings",
    {
      title: "List meetings",
      description:
        "List meetings by explicit meeting series and local meeting date. Use this instead of semantic search when the user names a recurring meeting series like HTS.",
      inputSchema: {
        series: z
          .string()
          .min(1)
          .describe("Meeting series name, for example `HTS`."),
        from: z
          .string()
          .optional()
          .describe("Inclusive local date lower bound as YYYY-MM-DD."),
        to: z
          .string()
          .optional()
          .describe("Inclusive local date upper bound as YYYY-MM-DD."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Max meetings to return (default 25, max 100)."),
      },
    },
    async (args) => (await listMeetings(args, env)) as any,
  );

  server.registerTool(
    "list_commitments",
    {
      title: "List commitments",
      description:
        "List extracted commitments/action items from meetings in an explicit series and local date range. Also calls out matched backfilled meetings that still need action-item extraction.",
      inputSchema: {
        series: z
          .string()
          .min(1)
          .describe("Meeting series name, for example `HTS`."),
        from: z
          .string()
          .optional()
          .describe("Inclusive local date lower bound as YYYY-MM-DD."),
        to: z
          .string()
          .optional()
          .describe("Inclusive local date upper bound as YYYY-MM-DD."),
        person: z
          .string()
          .optional()
          .describe("Optional owner/person substring to match, for example `Pierce`."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Max commitments to return (default 100, max 200)."),
      },
    },
    async (args) => (await listCommitments(args, env)) as any,
  );

  server.registerTool(
    "recent_calls",
    {
      title: "Recent calls",
      description:
        "List calls from the last N days, newest first. Useful for 'what did I do last week?' style queries.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe("Look-back window in days (default 7, max 365)."),
      },
    },
    async (args) => (await recentCalls(args, env)) as any,
  );

  return server;
}

/**
 * Handle one `/mcp` request end-to-end: new transport per request (stateless),
 * connect McpServer, dispatch, return the transport's Response.
 */
export async function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  const server = createMcpServer(env);
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode — no session state carried across requests.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}
