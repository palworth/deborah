/**
 * MCP server scaffold — registers the 5 aftercall tools on an McpServer
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
import { captureThought } from "../notes/inbox";

export function createMcpServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "aftercall", version: "0.5.0" },
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
    "capture_thought",
    {
      title: "Capture thought for Obsidian",
      description:
        "Capture a user brain dump, project update, task, or decision into Deborah's note inbox. The local sync agent will later write it into the user's Obsidian vault as Markdown.",
      inputSchema: {
        title: z.string().optional().describe("Short title for the captured dump."),
        dump: z.string().min(1).describe("The raw thought dump to preserve and sync to Obsidian."),
        summary: z.string().optional().describe("One or two sentence organized summary."),
        tags: z.array(z.string()).optional().describe("Obsidian-friendly tags without #."),
        projects: z
          .array(
            z.object({
              name: z.string().min(1),
              status: z.enum(["active", "paused", "waiting", "done"]).optional(),
              summary: z.string().optional(),
              notes: z.array(z.string()).optional(),
              nextActions: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .describe("Project notes or updates inferred from the dump."),
        people: z
          .array(
            z.object({
              name: z.string().min(1),
              summary: z.string().optional(),
              notes: z.array(z.string()).optional(),
              nextActions: z.array(z.string()).optional(),
            }),
          )
          .optional()
          .describe("People notes or follow-ups inferred from the dump."),
        tasks: z
          .array(
            z.object({
              text: z.string().min(1),
              project: z.string().optional(),
              person: z.string().optional(),
              due: z.string().optional(),
              priority: z.enum(["low", "medium", "high"]).optional(),
              status: z.enum(["todo", "doing", "done"]).optional(),
            }),
          )
          .optional()
          .describe("Concrete next actions from the dump."),
        decisions: z
          .array(
            z.object({
              title: z.string().min(1),
              project: z.string().optional(),
              decision: z.string().min(1),
              rationale: z.string().optional(),
            }),
          )
          .optional()
          .describe("Decisions to create as Obsidian decision notes."),
      },
    },
    async (args) => (await captureThought(args, env)) as any,
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
