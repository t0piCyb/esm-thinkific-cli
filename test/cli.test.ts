/**
 * Runs the built CLI against a fake Thinkific GraphQL API: endpoint choice
 * (stable/beta), slug fallback, settings carried over by `lessons update`,
 * the HTML backup, userErrors and the guard on non-text lessons.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Call = { api: string; operation: string; variables: Record<string, any>; auth: string | null };
const calls: Call[] = [];

const LESSONS: Record<string, any> = {
  "10": {
    id: "10", title: "Welcome", draft: false, lessonType: "TEXT", takeUrl: "https://x/take/10",
    settings: { draft: false, free: true, prerequisite: true, label: "Text", icon: "text" },
    chapter: { id: "5", title: "Session 1", position: 0 },
    course: { id: "1", name: "Year 1", slug: "year-1" },
    content: { __typename: "TextContent", contentType: "TEXT", updatedAt: "2026-11-01T00:00:00Z", htmlDescription: "<p>Old</p>" },
  },
  "11": {
    id: "11", title: "Video", draft: false, lessonType: "VIDEO", takeUrl: null, settings: null,
    chapter: { id: "5", title: "Session 1", position: 0 }, course: { id: "1", name: "Year 1", slug: "year-1" },
    content: { __typename: "VideoContent", contentType: "VIDEO", updatedAt: "2026-11-01T00:00:00Z", htmlDescription: "<p>Watch</p>" },
  },
};

const COURSE = {
  id: "1", name: "Year 1", title: "Year 1", slug: "year-1", description: null,
  product: { id: "p1", name: "Year 1", status: "PUBLISHED", hidden: false, private: false, slug: "year-1", landingPageUrl: null },
  curriculum: {
    chaptersCount: 1, lessonsCount: 2,
    chapters: {
      nodes: [{ id: "5", title: "Session 1", position: 0, lessons: { nodes: [
        { id: "10", title: "Welcome", draft: false, lessonType: "TEXT", takeUrl: null },
        { id: "11", title: "Video", draft: false, lessonType: "VIDEO", takeUrl: null },
      ], pageInfo: { hasNextPage: false } } }],
      pageInfo: { hasNextPage: false },
    },
  },
};

function answer(operation: string, v: Record<string, any>) {
  switch (operation) {
    case "CliCourse":
      return v.id === "1" ? { course: COURSE } : null; // null = "not an id": GraphQL error
    case "CliCourseBySlug":
      return { courseBySlug: v.slug === "year-1" ? COURSE : null };
    case "CliLesson":
      return { lesson: LESSONS[v.id] ?? null };
    case "CliUpdateTextLesson":
      return { updateTextLesson: { lesson: { id: v.input.lessonId, title: v.input.lessonSettingsInput.name, draft: v.input.lessonSettingsInput.draft, lessonType: "TEXT", chapter: { id: "5", title: "Session 1" } }, userErrors: [] } };
    case "CliCreateChapter":
      return { createChapter: { chapter: null, userErrors: [{ code: "INVALID", message: "Name is too long", path: ["name"] }] } };
    default:
      return undefined;
  }
}

let server: ReturnType<typeof Bun.serve>;
let home: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const api = new URL(req.url).pathname.split("/")[1]!;
      const body = (await req.json()) as { query: string; variables: Record<string, any> };
      const operation = body.query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "";
      calls.push({ api, operation, variables: body.variables, auth: req.headers.get("authorization") });
      const data = answer(operation, body.variables);
      if (data === null) return Response.json({ errors: [{ message: "Invalid ID", extensions: { code: "BAD_USER_INPUT" } }] });
      if (data === undefined) return Response.json({ errors: [{ message: `unexpected ${operation}` }] });
      return Response.json({ data, extensions: { rateLimit: { cost: 3, remaining: 1997, resetAt: new Date().toISOString(), limit: 2000 } } });
    },
  });
  home = mkdtempSync(join(tmpdir(), "esm-thinkific-test-"));
});

afterAll(() => server.stop(true));

async function cli(...args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "../src/index.ts"), ...args], {
    env: {
      ...process.env,
      HOME: home,
      THINKIFIC_API_TOKEN: "test-token",
      THINKIFIC_GRAPHQL_URL: `${server.url}stable/graphql`,
      THINKIFIC_GRAPHQL_BETA_URL: `${server.url}beta/graphql`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

describe("esm-thinkific-cli", () => {
  test("courses get falls back to the slug and lists the curriculum", async () => {
    calls.length = 0;
    const { stdout, code } = await cli("--json", "courses", "get", "year-1");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).data.id).toBe("1");
    expect(calls.map((c) => `${c.api} ${c.operation}`)).toEqual(["stable CliCourse", "stable CliCourseBySlug"]);
    expect(calls[0]!.auth).toBe("Bearer test-token");
  });

  test("lessons update keeps the settings it does not change and backs up the HTML", async () => {
    calls.length = 0;
    const file = join(home, "new.html");
    writeFileSync(file, "<p>New</p>");
    const { stdout, code, stderr } = await cli("--json", "lessons", "update", "10", "-f", file);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const update = calls.find((c) => c.operation === "CliUpdateTextLesson")!;
    expect(update.api).toBe("beta");
    expect(update.variables.input).toEqual({
      lessonId: "10",
      lessonSettingsInput: { name: "Welcome", draft: false, free: true, prerequisite: true },
      textContentInput: { htmlDescription: "<p>New</p>" },
    });
    const backup = JSON.parse(stdout).data.backup as string;
    expect(readFileSync(backup, "utf8")).toBe("<p>Old</p>");
    expect(readdirSync(join(home, ".cache", "esm-thinkific-cli", "backups"))).toHaveLength(1);
  });

  test("lessons update --dry-run sends nothing", async () => {
    calls.length = 0;
    const { code } = await cli("lessons", "update", "10", "--name", "Bienvenue", "--dry-run");
    expect(code).toBe(0);
    expect(calls.map((c) => c.operation)).toEqual(["CliLesson"]);
  });

  test("lessons update refuses a video lesson", async () => {
    const { stderr, code } = await cli("lessons", "update", "11", "--html", "<p>x</p>");
    expect(code).toBe(2);
    expect(stderr).toContain("only edits TEXT lessons");
  });

  test("userErrors become a readable error", async () => {
    const { stderr, code } = await cli("chapters", "create", "1", "--name", "x".repeat(300));
    expect(code).toBe(1);
    expect(stderr).toContain("Name is too long (name)");
  });

  test("lessons html prints the raw HTML", async () => {
    const { stdout, code } = await cli("lessons", "html", "11");
    expect(code).toBe(0);
    expect(stdout).toBe("<p>Watch</p>\n");
  });

  test("courses export writes course.json and the lesson HTML", async () => {
    const out = join(home, "export");
    const { code } = await cli("courses", "export", "1", "-o", out);
    expect(code).toBe(0);
    expect(readdirSync(join(out, "lessons")).sort()).toEqual(["00-00-10-welcome.html", "00-01-11-video.html"]);
    const exported = JSON.parse(readFileSync(join(out, "course.json"), "utf8"));
    expect(exported.chapters[0].lessons[0].htmlFile).toBe("lessons/00-00-10-welcome.html");
    expect(exported.chapters[0].lessons[0].content.htmlDescription).toBeUndefined();
  });
});
