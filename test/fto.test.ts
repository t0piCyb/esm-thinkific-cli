/**
 * FTO mode (default): the CLI runs the FTO app's `thinkific_*` tools with the
 * FTO key esm-fto-cli stores, never the Thinkific token. Runs the CLI against
 * a fake FTO app.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Call = { tool: string; input: Record<string, any>; key: string | null; source: string | null; version: string | null };
const calls: Call[] = [];

const COURSE = {
  id: "3512623", name: "AUTO UPLOAD TEST (Q1)", slug: "test", status: "DRAFT", hidden: false, private: false,
  landing_page_url: null, writable: true, warnings: [],
  chapters: [{ id: "5", title: "Class 2", position: 2, lessons: [
    { id: "10", title: "Welcome", type: "TEXT", draft: false, take_url: null },
    { id: "11", title: "Handout", type: "PDF", draft: false, take_url: null },
  ] }],
};

const LESSON = (id: string) => ({
  id, title: id === "10" ? "Welcome" : "Handout", type: id === "10" ? "TEXT" : "PDF", draft: false, take_url: null,
  settings: { draft: false, free: false, prerequisite: false }, chapter: { id: "5", title: "Class 2", position: 2 },
  course: { id: "3512623", name: "AUTO UPLOAD TEST (Q1)", slug: "test" }, writable: true, editable: id === "10",
  html: id === "10" ? "<p>Old</p>" : null, content_type: "TEXT", updated_at: "t", url: id === "11" ? "https://x/h.pdf" : null,
  files: [], captions: [],
});

function answer(tool: string, input: Record<string, any>): [number, unknown] {
  switch (tool) {
    case "whoami":
      return [200, { user: { name: "Staff", email: "staff@example.org", role: "staff" } }];
    case "thinkific_list_courses":
      return [200, { courses: [{ id: "3512623", name: "AUTO UPLOAD TEST (Q1)", slug: "test", status: "DRAFT", hidden: false, chapters: 1, lessons: 2 }], has_more: false }];
    case "thinkific_get_course":
      return input.course === "test" ? [200, COURSE] : [404, { error: { status: 404, message: "Thinkific: No Thinkific course" } }];
    case "thinkific_get_lesson":
      return [200, LESSON(input.lesson)];
    case "thinkific_update_text_lesson":
      if (input.lesson === "11") return [403, { error: { status: 403, message: "Thinkific: PDF lesson: Thinkific's API only edits TEXT lessons" } }];
      return [200, { title_after: input.name ?? "Welcome", draft_after: false, allowed: true, dry_run: input.dryRun, ...(input.dryRun ? {} : { lesson: { id: "10" }, previous_html: "<p>Old</p>" }) }];
    case "thinkific_create_text_lesson":
      return [200, { course: { id: "3512623", name: "T" }, chapter: { id: input.chapterId, title: "Class 2" }, allowed: true, dry_run: input.dryRun, lesson: { id: "99", title: input.name, draft: input.draft } }];
    default:
      return [404, { error: { status: 404, message: `Tool "${tool}" not found. List the tools with GET /api/v1/tools` } }];
  }
}

let server: ReturnType<typeof Bun.serve>;
let home: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const tool = new URL(req.url).pathname.replace("/api/v1/tools/", "");
      const input = (await req.json()) as Record<string, any>;
      calls.push({ tool, input, key: req.headers.get("x-api-key"), source: req.headers.get("x-tool-source"), version: req.headers.get("x-cli-version") });
      const [status, body] = answer(tool, input);
      return Response.json(body, { status });
    },
  });
  home = mkdtempSync(join(tmpdir(), "esm-thinkific-fto-"));
  // What `esm-fto-cli auth set <key> --profile local --url ...` leaves behind
  mkdirSync(join(home, ".config", "tokens"), { recursive: true });
  mkdirSync(join(home, ".config", "esm-fto-cli"), { recursive: true });
  writeFileSync(join(home, ".config", "tokens", "esm-fto-cli-local.txt"), "esm_testkey\n");
  writeFileSync(
    join(home, ".config", "esm-fto-cli", "state.json"),
    JSON.stringify({ active: "local", profiles: { local: { url: `${server.url}`.replace(/\/$/, "") } } }),
  );
});

afterAll(() => server.stop(true));

async function cli(...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, HOME: home, ESM_CLI_NO_UPDATE_CHECK: "1" };
  delete env.THINKIFIC_API_TOKEN;
  delete env.ESM_FTO_API_KEY;
  delete env.ESM_FTO_API_URL;
  delete env.ESM_FTO_PROFILE;
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "../src/index.ts"), ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { stdout, stderr, code };
}

describe("FTO mode", () => {
  test("reads go through the FTO tools with the esm-fto-cli key", async () => {
    calls.length = 0;
    const { stdout, code } = await cli("--json", "courses", "get", "test");
    expect(code).toBe(0);
    const course = JSON.parse(stdout).data;
    expect(course.curriculum.chapters.nodes[0].lessons.nodes[1].lessonType).toBe("PDF");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: "thinkific_get_course", input: { course: "test" }, key: "esm_testkey", source: "cli" });
    expect(calls[0]!.version).toMatch(/^esm-thinkific-cli\/\d+\.\d+\.\d+$/);
  });

  test("lessons html and export work through FTO", async () => {
    expect((await cli("lessons", "html", "10")).stdout).toBe("<p>Old</p>\n");
    const out = join(home, "export");
    expect((await cli("courses", "export", "test", "-o", out)).code).toBe(0);
    expect(readFileSync(join(out, "lessons", "02-00-10-welcome.html"), "utf8")).toBe("<p>Old</p>");
  });

  test("lessons update sends only what changes and backs up the previous HTML", async () => {
    calls.length = 0;
    const file = join(home, "fr.html");
    writeFileSync(file, "<p>Bonjour</p>");
    const { stdout, code } = await cli("--json", "lessons", "update", "10", "-f", file);
    expect(code).toBe(0);
    expect(calls[0]).toMatchObject({ tool: "thinkific_update_text_lesson", input: { lesson: "10", html: "<p>Bonjour</p>", dryRun: false } });
    expect(calls[0]!.input).not.toHaveProperty("draft");
    expect(readFileSync(JSON.parse(stdout).data.backup, "utf8")).toBe("<p>Old</p>");
  });

  test("the server's refusal reaches the user", async () => {
    const { stderr, code } = await cli("lessons", "update", "11", "--html", "<p>x</p>");
    expect(code).toBe(1);
    expect(stderr).toContain("only edits TEXT lessons");
  });

  test("lessons create needs --course and makes drafts by default", async () => {
    expect((await cli("lessons", "create", "5", "--name", "X", "--html", "<p>x</p>")).stderr).toContain("--course");
    calls.length = 0;
    const { code } = await cli("lessons", "create", "5", "--course", "test", "--name", "Leçon", "--html", "<p>x</p>");
    expect(code).toBe(0);
    expect(calls[0]!.input).toMatchObject({ course: "test", chapterId: "5", draft: true });
  });

  test("site-token commands ask for --direct", async () => {
    const { stderr, code } = await cli("chapters", "delete", "5", "--yes");
    expect(code).toBe(2);
    expect(stderr).toContain("--direct");
  });

  test("auth test shows the FTO user", async () => {
    const { stdout, code } = await cli("--json", "auth", "test");
    expect(code).toBe(0);
    expect(JSON.parse(stdout).data).toMatchObject({ ftoProfile: "local", role: "staff", thinkific: "reachable" });
  });
});
