export interface IntakeTask {
  text: string;
  project?: string;
  person?: string;
  due?: string;
  priority?: "low" | "medium" | "high";
  status?: "todo" | "doing" | "done";
}

export interface IntakeProject {
  name: string;
  status?: "active" | "paused" | "waiting" | "done";
  summary?: string;
  notes?: string[];
  nextActions?: string[];
}

export interface IntakePerson {
  name: string;
  summary?: string;
  notes?: string[];
  nextActions?: string[];
}

export interface IntakeDecision {
  title: string;
  project?: string;
  decision: string;
  rationale?: string;
}

export interface IntakePlan {
  title?: string;
  dump: string;
  summary?: string;
  tags?: string[];
  projects?: IntakeProject[];
  people?: IntakePerson[];
  tasks?: IntakeTask[];
  decisions?: IntakeDecision[];
}

export interface IntakeDocument {
  path: string;
  mode: "create" | "append-or-create";
  createContent: string;
  appendContent?: string;
}

interface BuildOptions {
  now?: Date;
}

const DEFAULT_TITLE = "Notes dump";

export function sanitizeNoteName(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[\\/:*?"<>|[\]^#]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return cleaned || "Untitled";
}

export function buildIntakeDocuments(plan: IntakePlan, options: BuildOptions = {}): IntakeDocument[] {
  const now = options.now ?? new Date();
  const date = toDate(now);
  const time = toTime(now);
  const title = plan.title?.trim() || DEFAULT_TITLE;
  const safeTitle = sanitizeNoteName(title);
  const rawDumpPath = `Inbox/Dumps/${date} ${time.replace(":", "")} - ${safeTitle}.md`;
  const summary = plan.summary?.trim();
  const tags = normalizeTags(["inbox/dump", "context/intake", ...(plan.tags ?? [])]);
  const docs: IntakeDocument[] = [
    {
      path: rawDumpPath,
      mode: "create",
      createContent: [
        frontmatter({
          title,
          date,
          type: "dump",
          source: "codex",
          tags,
        }),
        `# ${title}`,
        "",
        summary ? "## Summary" : "",
        summary ? summary : "",
        summary ? "" : "",
        "## Raw Dump",
        "",
        plan.dump.trim(),
        "",
        relatedLinks(plan),
      ]
        .filter((line) => line !== "")
        .join("\n"),
    },
  ];

  docs.push(buildDailyDocument(plan, { date, time, title, rawDumpPath, summary }));

  if (plan.tasks?.length) {
    docs.push(buildNextActionsDocument(plan.tasks, { date, title, rawDumpPath }));
  }

  for (const project of plan.projects ?? []) {
    docs.push(buildProjectDocument(project, { date, rawDumpPath }));
  }

  for (const person of plan.people ?? []) {
    docs.push(buildPersonDocument(person, { date, rawDumpPath }));
  }

  for (const decision of plan.decisions ?? []) {
    docs.push(buildDecisionDocument(decision, { date, rawDumpPath }));
  }

  return docs;
}

export function buildBootstrapDocuments(): IntakeDocument[] {
  return [
    {
      path: "Dashboards/Active Projects.base",
      mode: "create",
      createContent: [
        'filters: \'file.inFolder("Projects") && status != "done"\'',
        "views:",
        "  - type: table",
        '    name: "Active Projects"',
        "    order:",
        "      - file.name",
        "      - status",
        "      - priority",
        "      - file.mtime",
        "",
      ].join("\n"),
    },
    {
      path: "Dashboards/Next Actions.base",
      mode: "create",
      createContent: [
        'filters: \'file.hasTag("task")\'',
        "views:",
        "  - type: table",
        '    name: "Next Actions"',
        "    order:",
        "      - file.name",
        "      - file.folder",
        "      - due",
        "      - priority",
        "",
      ].join("\n"),
    },
    {
      path: "Dashboards/Waiting On.base",
      mode: "create",
      createContent: [
        'filters: \'status == "waiting" || file.hasTag("waiting")\'',
        "views:",
        "  - type: table",
        '    name: "Waiting On"',
        "    order:",
        "      - file.name",
        "      - owner",
        "      - file.mtime",
        "",
      ].join("\n"),
    },
  ];
}

function buildDailyDocument(
  plan: IntakePlan,
  context: { date: string; time: string; title: string; rawDumpPath: string; summary?: string },
): IntakeDocument {
  const tasks = plan.tasks ?? [];
  const appendContent = [
    "",
    `## ${context.time} - ${context.title}`,
    "",
    `Source: [[${noteTarget(context.rawDumpPath)}]]`,
    context.summary ? `Summary: ${context.summary}` : "",
    tasks.length ? "" : "",
    tasks.length ? "### Next Actions" : "",
    ...tasks.map(formatTask),
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    path: `Inbox/${context.date}.md`,
    mode: "append-or-create",
    createContent: [
      frontmatter({
        title: `Inbox ${context.date}`,
        date: context.date,
        type: "daily-inbox",
        tags: ["inbox/daily"],
      }),
      `# Inbox ${context.date}`,
      appendContent,
    ].join("\n"),
    appendContent,
  };
}

function buildNextActionsDocument(
  tasks: IntakeTask[],
  context: { date: string; title: string; rawDumpPath: string },
): IntakeDocument {
  const appendContent = [
    "",
    `## ${context.date} - ${context.title}`,
    "",
    `Source: [[${noteTarget(context.rawDumpPath)}]]`,
    ...tasks.map(formatTask),
    "",
  ].join("\n");

  return {
    path: "Next Actions.md",
    mode: "append-or-create",
    createContent: [
      frontmatter({
        title: "Next Actions",
        type: "task-index",
        tags: ["task"],
      }),
      "# Next Actions",
      appendContent,
    ].join("\n"),
    appendContent,
  };
}

function buildProjectDocument(
  project: IntakeProject,
  context: { date: string; rawDumpPath: string },
): IntakeDocument {
  const name = sanitizeNoteName(project.name);
  const appendContent = [
    "",
    `## Update ${context.date}`,
    "",
    `Source: [[${noteTarget(context.rawDumpPath)}]]`,
    project.summary ? `Summary: ${project.summary}` : "",
    listSection("Notes", project.notes),
    listSection("Next Actions", project.nextActions, "- [ ]"),
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    path: `Projects/${name}.md`,
    mode: "append-or-create",
    createContent: [
      frontmatter({
        title: project.name,
        type: "project",
        status: project.status ?? "active",
        tags: ["project"],
      }),
      `# ${project.name}`,
      appendContent,
    ].join("\n"),
    appendContent,
  };
}

function buildPersonDocument(
  person: IntakePerson,
  context: { date: string; rawDumpPath: string },
): IntakeDocument {
  const name = sanitizeNoteName(person.name);
  const appendContent = [
    "",
    `## Update ${context.date}`,
    "",
    `Source: [[${noteTarget(context.rawDumpPath)}]]`,
    person.summary ? `Summary: ${person.summary}` : "",
    listSection("Notes", person.notes),
    listSection("Next Actions", person.nextActions, "- [ ]"),
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    path: `People/${name}.md`,
    mode: "append-or-create",
    createContent: [
      frontmatter({
        title: person.name,
        type: "person",
        tags: ["person"],
      }),
      `# ${person.name}`,
      appendContent,
    ].join("\n"),
    appendContent,
  };
}

function buildDecisionDocument(
  decision: IntakeDecision,
  context: { date: string; rawDumpPath: string },
): IntakeDocument {
  const title = sanitizeNoteName(decision.title);
  return {
    path: `Decisions/${context.date} - ${title}.md`,
    mode: "create",
    createContent: [
      frontmatter({
        title: decision.title,
        date: context.date,
        type: "decision",
        project: decision.project ? `[[${sanitizeNoteName(decision.project)}]]` : undefined,
        tags: ["decision"],
      }),
      `# ${decision.title}`,
      "",
      `Source: [[${noteTarget(context.rawDumpPath)}]]`,
      "",
      "## Decision",
      "",
      decision.decision,
      decision.rationale ? "" : "",
      decision.rationale ? "## Rationale" : "",
      decision.rationale ? "" : "",
      decision.rationale ?? "",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}

function formatTask(task: IntakeTask): string {
  const checkbox = task.status === "done" ? "[x]" : "[ ]";
  const due = task.due ? ` (due: ${task.due})` : "";
  const priority = task.priority ? ` (priority: ${task.priority})` : "";
  const project = task.project ? ` [[${sanitizeNoteName(task.project)}]]` : "";
  const person = task.person ? ` [[${sanitizeNoteName(task.person)}]]` : "";
  return `- ${checkbox} ${task.text}${due}${priority}${project}${person}`;
}

function relatedLinks(plan: IntakePlan): string {
  const links = [
    ...(plan.projects ?? []).map((project) => `[[${sanitizeNoteName(project.name)}]]`),
    ...(plan.people ?? []).map((person) => `[[${sanitizeNoteName(person.name)}]]`),
  ];
  if (links.length === 0) return "";
  return ["## Related", "", links.join(" ")].join("\n");
}

function listSection(title: string, items: string[] | undefined, marker = "-"): string {
  if (!items?.length) return "";
  return [`### ${title}`, ...items.map((item) => `${marker} ${item}`), ""].join("\n");
}

function toDate(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-");
}

function toTime(date: Date): string {
  return [pad2(date.getHours()), pad2(date.getMinutes())].join(":");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function noteTarget(path: string): string {
  return path.replace(/\.md$/, "");
}

function normalizeTags(tags: string[]): string[] {
  return tags
    .map((tag) =>
      tag
        .trim()
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9/_-]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
}

function frontmatter(values: Record<string, string | string[] | undefined>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quoteYaml(item)}`);
    } else {
      lines.push(`${key}: ${quoteYaml(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

function quoteYaml(value: string): string {
  if (/^[a-z0-9/_-]+$/i.test(value)) return value;
  return JSON.stringify(value);
}
