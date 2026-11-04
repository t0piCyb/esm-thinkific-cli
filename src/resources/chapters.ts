import { Command } from "commander";
import { gql, mutate } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { CHAPTER, CREATE_CHAPTER, REMOVE_CHAPTER, REORDER_CHAPTER, UPDATE_CHAPTER } from "../lib/operations.js";
import { output } from "../lib/output.js";
import { getCourse } from "../lib/thinkific.js";

type Chapter = { id: string; title: string; position: number };
type ChapterDetail = Chapter & {
  lessonsCount: number;
  lessons: { nodes: ({ id: string; title: string; draft: boolean; lessonType: string | null } | null)[] | null };
};

const position = (value: string) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new CliError(2, `Invalid position "${value}" (0 or more)`);
  return n;
};

export const chaptersResource = new Command("chapters").description(
  "Chapters of a course: read, create, rename, move, delete (writes use Thinkific's beta API)",
);

chaptersResource
  .command("get")
  .description("A chapter and its lessons")
  .argument("<chapter-id>", "Chapter id (see: courses get <course>)")
  .action(async (id: string) => {
    try {
      const { chapter } = await gql<{ chapter: ChapterDetail | null }>(CHAPTER, { id });
      if (!chapter) throw new CliError(404, `No Thinkific chapter ${id}`);
      if (globalFlags.format !== "text") {
        output(chapter);
        return;
      }
      output({ id: chapter.id, title: chapter.title, position: chapter.position, lessons: chapter.lessonsCount });
      console.log();
      output(
        (chapter.lessons.nodes ?? []).flatMap((l, index) =>
          l ? [{ position: index, lessonId: l.id, lesson: l.title, type: l.lessonType, draft: l.draft }] : [],
        ),
      );
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

chaptersResource
  .command("create")
  .description("Add a chapter to a course")
  .argument("<course>", "Course id or slug")
  .requiredOption("--name <name>", "Chapter title")
  .option("--position <n>", "Position in the course (default: last)")
  .action(async (ref: string, opts: { name: string; position?: string }) => {
    try {
      const course = await getCourse(ref);
      const { chapter } = await mutate<{ chapter: Chapter }>(CREATE_CHAPTER, "createChapter", {
        courseId: course.id,
        name: opts.name,
        ...(opts.position !== undefined && { position: position(opts.position) }),
      });
      if (globalFlags.json) output(chapter);
      else log.success(`Chapter "${chapter.title}" (${chapter.id}) added to "${course.name}" at position ${chapter.position}`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

chaptersResource
  .command("rename")
  .description("Change a chapter's title")
  .argument("<chapter-id>", "Chapter id")
  .requiredOption("--name <name>", "New title")
  .action(async (id: string, opts: { name: string }) => {
    try {
      const { chapter } = await mutate<{ chapter: Chapter }>(UPDATE_CHAPTER, "updateChapter", { id, name: opts.name });
      if (globalFlags.json) output(chapter);
      else log.success(`Chapter ${chapter.id} renamed "${chapter.title}"`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

chaptersResource
  .command("move")
  .description("Move a chapter to another position in its course (the others shift)")
  .argument("<chapter-id>", "Chapter id")
  .requiredOption("--course <course>", "Course id or slug the chapter belongs to")
  .requiredOption("--to <n>", "New position, as shown by courses get")
  .action(async (id: string, opts: { course: string; to: string }) => {
    try {
      const course = await getCourse(opts.course);
      const { chapter } = await mutate<{ chapter: Chapter }>(REORDER_CHAPTER, "reorderChapter", {
        chapterId: id,
        courseId: course.id,
        newPosition: position(opts.to),
      });
      if (globalFlags.json) output(chapter);
      else log.success(`Chapter "${chapter.title}" is now at position ${chapter.position}`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

chaptersResource
  .command("delete")
  .alias("rm")
  .description("Delete a chapter AND its lessons (cannot be undone from the CLI)")
  .argument("<chapter-id>", "Chapter id")
  .option("--yes", "Confirm the deletion")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      const { chapter } = await gql<{ chapter: ChapterDetail | null }>(CHAPTER, { id });
      if (!chapter) throw new CliError(404, `No Thinkific chapter ${id}`);
      if (!opts.yes) {
        throw new CliError(
          2,
          `This deletes chapter "${chapter.title}" and its ${chapter.lessonsCount} lesson(s).`,
          `Export the course first (courses export), then add --yes`,
        );
      }
      await mutate(REMOVE_CHAPTER, "removeChapter", { id });
      if (globalFlags.json) output({ deleted: id, title: chapter.title });
      else log.success(`Chapter "${chapter.title}" deleted`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
