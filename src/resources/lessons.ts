import { Command } from "commander";
import { mutate } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput, writeOutput } from "../lib/io.js";
import { log } from "../lib/logger.js";
import { COPY_LESSON, CREATE_TEXT_LESSON, REORDER_LESSON, UPDATE_TEXT_LESSON } from "../lib/operations.js";
import { output } from "../lib/output.js";
import { backupLessonHtml, getLesson, type Lesson } from "../lib/thinkific.js";

type LessonResult = { id: string; title: string; draft: boolean; lessonType: string | null; chapter: { id: string; title: string } | null };

const position = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new CliError(2, `Invalid position "${value}" (0 or more)`);
  return n;
};

/** HTML from --html or a file (-f, "-" for stdin). */
async function htmlFrom(opts: { file?: string; html?: string }): Promise<string | undefined> {
  if (opts.file && opts.html !== undefined) throw new CliError(2, "Pass -f/--file or --html, not both");
  if (opts.html !== undefined) return opts.html;
  if (opts.file) return readInput(opts.file);
  return undefined;
}

const files = (lesson: Lesson) =>
  (lesson.content?.downloads?.nodes ?? []).flatMap((f) => (f ? [`${f.name ?? f.id} ${f.url ?? ""}`.trim()] : []));

export const lessonsResource = new Command("lessons").description(
  "Lessons: read any lesson, create and edit text lessons (HTML), move and copy (writes use Thinkific's beta API)",
);

lessonsResource
  .command("get")
  .description("A lesson: type, chapter, course, settings, media URLs (HTML with `lessons html`)")
  .argument("<lesson-id>", "Lesson id (see: courses get <course>)")
  .action(async (id: string) => {
    try {
      const lesson = await getLesson(id);
      if (globalFlags.format !== "text") {
        output(lesson);
        return;
      }
      const content = lesson.content;
      output({
        id: lesson.id,
        title: lesson.title,
        type: lesson.lessonType,
        draft: lesson.draft,
        free: lesson.settings?.free,
        course: lesson.course ? `${lesson.course.name} (${lesson.course.id})` : null,
        chapter: lesson.chapter ? `${lesson.chapter.title} (${lesson.chapter.id})` : null,
        updatedAt: content?.updatedAt,
        html: content?.htmlDescription ? `${content.htmlDescription.length} characters (lessons html ${lesson.id})` : null,
        url: content?.url ?? content?.sourceUrl ?? content?.playUrl ?? null,
        captions: content?.captions?.map((c) => c.languageCode).join(", ") || null,
        files: files(lesson).join(" | ") || null,
        takeUrl: lesson.takeUrl,
      });
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

lessonsResource
  .command("html")
  .description("Print a lesson's HTML (text lessons; description of video, audio and download lessons)")
  .argument("<lesson-id>", "Lesson id")
  .option("-o, --out <file>", "Write to a file instead of stdout")
  .action(async (id: string, opts: { out?: string }) => {
    try {
      const lesson = await getLesson(id);
      const html = lesson.content?.htmlDescription;
      if (html === undefined || html === null) {
        throw new CliError(404, `Lesson ${id} (${lesson.lessonType}) has no HTML`);
      }
      writeOutput(html, opts.out);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

lessonsResource
  .command("create")
  .description("Add a text lesson (HTML) to a chapter")
  .argument("<chapter-id>", "Chapter id (see: courses get <course>)")
  .requiredOption("--name <name>", "Lesson title")
  .option("-f, --file <file>", "HTML file, or - for stdin")
  .option("--html <html>", "HTML inline")
  .option("--position <n>", "Position in the chapter (default: last)")
  .option("--draft", "Create it as a draft (hidden from students)")
  .option("--free", "Free preview lesson")
  .option("--dry-run", "Print what would be sent, change nothing")
  .addHelpText("after", "\nExample:\n  esm-thinkific-cli lessons create 123 --name \"Session 4 - Handouts\" -f session4.html --draft")
  .action(async (chapterId: string, opts: { name: string; file?: string; html?: string; position?: string; draft?: boolean; free?: boolean; dryRun?: boolean }) => {
    try {
      const html = await htmlFrom(opts);
      const input = {
        chapterId,
        lessonSettingsInput: {
          name: opts.name,
          draft: Boolean(opts.draft),
          free: Boolean(opts.free),
          ...(opts.position !== undefined && { position: position(opts.position) }),
        },
        ...(html !== undefined && { textContentInput: { htmlDescription: html } }),
      };
      if (opts.dryRun) {
        output({ mutation: "createTextLesson", input });
        return;
      }
      const { lesson } = await mutate<{ lesson: LessonResult }>(CREATE_TEXT_LESSON, "createTextLesson", input);
      if (globalFlags.json) output(lesson);
      else log.success(`Lesson "${lesson.title}" (${lesson.id}) created${lesson.draft ? " as a draft" : ""}`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

lessonsResource
  .command("update")
  .description("Change a text lesson's HTML and/or title or draft state; the previous HTML is backed up first")
  .argument("<lesson-id>", "Lesson id")
  .option("-f, --file <file>", "New HTML from a file, or - for stdin")
  .option("--html <html>", "New HTML inline")
  .option("--name <name>", "New title")
  .option("--draft", "Make it a draft (hidden from students)")
  .option("--publish", "Make it visible to students")
  .option("--dry-run", "Print what would be sent, change nothing")
  .addHelpText(
    "after",
    "\nWorkflow:\n  esm-thinkific-cli lessons html 456 -o lesson.html   # edit or translate lesson.html\n  esm-thinkific-cli lessons update 456 -f lesson.html --dry-run\n  esm-thinkific-cli lessons update 456 -f lesson.html\nBackups: ~/.cache/esm-thinkific-cli/backups/<lesson-id>-<time>.html",
  )
  .action(async (id: string, opts: { file?: string; html?: string; name?: string; draft?: boolean; publish?: boolean; dryRun?: boolean }) => {
    try {
      if (opts.draft && opts.publish) throw new CliError(2, "Pass --draft or --publish, not both");
      const html = await htmlFrom(opts);
      if (html === undefined && opts.name === undefined && !opts.draft && !opts.publish) {
        throw new CliError(2, "Nothing to change", "Pass -f/--html, --name, --draft or --publish");
      }

      const lesson = await getLesson(id);
      if (lesson.lessonType !== "TEXT") {
        throw new CliError(2, `Lesson ${id} is a ${lesson.lessonType} lesson; the Thinkific API only edits TEXT lessons`);
      }
      // The settings input replaces them: carry over what is not being changed.
      const input = {
        lessonId: id,
        lessonSettingsInput: {
          name: opts.name ?? lesson.title,
          draft: opts.draft ? true : opts.publish ? false : (lesson.settings?.draft ?? lesson.draft),
          free: lesson.settings?.free ?? false,
          prerequisite: lesson.settings?.prerequisite ?? false,
        },
        ...(html !== undefined && { textContentInput: { htmlDescription: html } }),
      };
      if (opts.dryRun) {
        const before = lesson.content?.htmlDescription ?? "";
        output({
          mutation: "updateTextLesson",
          lesson: `${lesson.title} (${lesson.course?.name ?? "?"} / ${lesson.chapter?.title ?? "?"})`,
          htmlChanged: html !== undefined && html !== before,
          htmlLength: html !== undefined ? `${before.length} -> ${html.length}` : "unchanged",
          input: { ...input, ...(html !== undefined && { textContentInput: { htmlDescription: `(${html.length} characters)` } }) },
        });
        return;
      }

      const backup = html !== undefined ? backupLessonHtml(lesson) : null;
      const result = await mutate<{ lesson: LessonResult }>(UPDATE_TEXT_LESSON, "updateTextLesson", input);
      if (globalFlags.json) output({ ...result.lesson, backup });
      else {
        log.success(`Lesson "${result.lesson.title}" (${id}) updated${result.lesson.draft ? " (draft)" : ""}`);
        if (backup) log.info(`Previous HTML: ${backup}`);
      }
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

lessonsResource
  .command("move")
  .description("Move a lesson to another position, or to another chapter of the same course")
  .argument("<lesson-id>", "Lesson id")
  .requiredOption("--chapter <chapter-id>", "Target chapter (the same one to reorder)")
  .requiredOption("--to <n>", "New position in that chapter, as shown by courses get")
  .action(async (id: string, opts: { chapter: string; to: string }) => {
    try {
      const { lesson } = await mutate<{ lesson: LessonResult }>(REORDER_LESSON, "reorderLesson", {
        lessonId: id,
        chapterId: opts.chapter,
        newPosition: position(opts.to),
      });
      if (globalFlags.json) output(lesson);
      else log.success(`Lesson "${lesson.title}" moved to chapter "${lesson.chapter?.title ?? opts.chapter}" at position ${opts.to}`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

lessonsResource
  .command("copy")
  .description("Copy a lesson (any type) into a chapter")
  .argument("<lesson-id>", "Lesson id")
  .requiredOption("--chapter <chapter-id>", "Chapter receiving the copy")
  .option("--position <n>", "Position in that chapter (default: last)")
  .action(async (id: string, opts: { chapter: string; position?: string }) => {
    try {
      const { lesson } = await mutate<{ lesson: LessonResult }>(COPY_LESSON, "copyLesson", {
        lessonId: id,
        chapterId: opts.chapter,
        ...(opts.position !== undefined && { position: position(opts.position) }),
      });
      if (globalFlags.json) output(lesson);
      else log.success(`Lesson copied as "${lesson.title}" (${lesson.id}) in chapter "${lesson.chapter?.title ?? opts.chapter}"`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
