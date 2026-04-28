import { describe, expect, it } from "vitest";
import {
  buildBootstrapDocuments,
  buildIntakeDocuments,
  sanitizeNoteName,
} from "./intake";

const NOW = new Date(2026, 3, 27, 15, 4, 5);

describe("obsidian intake documents", () => {
  it("preserves the raw dump and appends an organized daily capture", () => {
    const docs = buildIntakeDocuments(
      {
        title: "Monday planning / messy dump",
        dump: "I need to clean up Project Atlas and follow up with Sarah.",
        summary: "Project Atlas needs cleanup and Sarah needs a follow-up.",
        tags: ["planning", "work notes"],
        tasks: [
          {
            text: "Follow up with Sarah about Project Atlas",
            project: "Project Atlas",
            person: "Sarah",
            due: "2026-04-30",
            priority: "high",
          },
        ],
      },
      { now: NOW },
    );

    expect(docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "Inbox/Dumps/2026-04-27 1504 - Monday planning messy dump.md",
          mode: "create",
        }),
        expect.objectContaining({
          path: "Inbox/2026-04-27.md",
          mode: "append-or-create",
        }),
        expect.objectContaining({
          path: "Next Actions.md",
          mode: "append-or-create",
        }),
      ]),
    );

    const rawDump = docs.find((doc) => doc.path.startsWith("Inbox/Dumps/"));
    expect(rawDump?.createContent).toContain("type: dump");
    expect(rawDump?.createContent).toContain("# Monday planning / messy dump");
    expect(rawDump?.createContent).toContain("## Raw Dump");
    expect(rawDump?.createContent).toContain("I need to clean up Project Atlas");

    const nextActions = docs.find((doc) => doc.path === "Next Actions.md");
    expect(nextActions?.appendContent).toContain(
      "- [ ] Follow up with Sarah about Project Atlas (due: 2026-04-30) (priority: high) [[Project Atlas]] [[Sarah]]",
    );
  });

  it("creates project, person, and decision updates with wikilinks", () => {
    const docs = buildIntakeDocuments(
      {
        title: "Solar ops notes",
        dump: "Decided to make intake the source of truth.",
        projects: [
          {
            name: "Solar Ops",
            status: "active",
            summary: "Intake workflow is becoming the source of truth.",
            notes: ["Move scattered notes into one project surface."],
            nextActions: ["Draft the first intake workflow"],
          },
        ],
        people: [
          {
            name: "Jamie Chen",
            notes: ["Owns project review feedback."],
            nextActions: ["Ask Jamie for review timing"],
          },
        ],
        decisions: [
          {
            title: "Use Obsidian as the notes source of truth",
            project: "Solar Ops",
            decision: "Keep organized notes in Obsidian and index them later.",
            rationale: "This keeps the local vault useful before building sync.",
          },
        ],
      },
      { now: NOW },
    );

    expect(docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "Projects/Solar Ops.md" }),
        expect.objectContaining({ path: "People/Jamie Chen.md" }),
        expect.objectContaining({
          path: "Decisions/2026-04-27 - Use Obsidian as the notes source of truth.md",
        }),
      ]),
    );

    const project = docs.find((doc) => doc.path === "Projects/Solar Ops.md");
    expect(project?.createContent).toContain("status: active");
    expect(project?.appendContent).toContain("[[Inbox/Dumps/2026-04-27 1504 - Solar ops notes]]");
    expect(project?.appendContent).toContain("- [ ] Draft the first intake workflow");

    const decision = docs.find((doc) => doc.path.startsWith("Decisions/"));
    expect(decision?.createContent).toContain("project: \"[[Solar Ops]]\"");
    expect(decision?.createContent).toContain("Keep organized notes in Obsidian");
  });

  it("sanitizes note names without flattening readable spaces", () => {
    expect(sanitizeNoteName("  ACME: Design/Build? <Plan>  ")).toBe("ACME DesignBuild Plan");
    expect(sanitizeNoteName("")).toBe("Untitled");
  });
});

describe("obsidian bootstrap documents", () => {
  it("creates base dashboards for projects and actions", () => {
    const docs = buildBootstrapDocuments();

    expect(docs.map((doc) => doc.path)).toEqual([
      "Dashboards/Active Projects.base",
      "Dashboards/Next Actions.base",
      "Dashboards/Waiting On.base",
    ]);
    expect(docs[0].createContent).toContain('file.inFolder("Projects")');
    expect(docs[1].createContent).toContain('file.hasTag("task")');
  });
});
