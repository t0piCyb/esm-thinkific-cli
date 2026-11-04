import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { gql, mutate, paginate } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { COURSES, DUPLICATE_COURSE, UPDATE_PRODUCT } from "../lib/operations.js";
import { output } from "../lib/output.js";
import {
  chaptersOf,
  curriculumRows,
  getCourse,
  getLesson,
  lessonsOf,
  slugify,
  truncationWarnings,
} from "../lib/thinkific.js";

type CourseListItem = {
  id: string;
  name: string;
  slug: string;
  product: { id: string; status: string; hidden: boolean; private: boolean };
  curriculum: { chaptersCount: number; lessonsCount: number };
};
type CoursesPage = {
  site: {
    courses: { nodes: (CourseListItem | null)[] | null; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  };
};

const STATUSES = ["DRAFT", "PUBLISHED", "PRESELL", "PENDING_APPROVAL"];

const parseStatuses = (value?: string) => {
  if (!value) return undefined;
  const statuses = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknown = statuses.filter((s) => !STATUSES.includes(s));
  if (unknown.length) throw new CliError(2, `Unknown status ${unknown.join(", ")}; use ${STATUSES.join(", ")}`);
  return statuses;
};

export const coursesResource = new Command("courses").description("Courses: list, curriculum, settings, export");

coursesResource
  .command("list")
  .alias("ls")
  .description("List the site's courses with their status and size")
  .option("--search <text>", "Text in the course name")
  .option("--status <list>", `Product status, comma separated (${STATUSES.join(", ")})`)
  .option("--archived", "Archived courses instead of active ones")
  .option("--limit <n>", "Max results", "500")
  .addHelpText("after", "\nExamples:\n  esm-thinkific-cli courses list\n  esm-thinkific-cli courses list --search \"Year 1\" --status PUBLISHED --json")
  .action(async (opts: { search?: string; status?: string; archived?: boolean; limit: string }) => {
    try {
      const filter = {
        ...(opts.search && { name: opts.search }),
        ...(opts.status && { productStatus: parseStatuses(opts.status) }),
        isArchived: Boolean(opts.archived),
      };
      const courses = await paginate<CourseListItem>(async (after) => {
        const data = await gql<CoursesPage>(COURSES, { first: 50, after, filter });
        return data.site.courses;
      }, Number(opts.limit));
      output(
        courses.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          status: c.product.status,
          hidden: c.product.hidden,
          chapters: c.curriculum.chaptersCount,
          lessons: c.curriculum.lessonsCount,
        })),
      );
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

coursesResource
  .command("get")
  .description("A course and its curriculum: chapters and lessons with their ids, types and draft state")
  .argument("<course>", "Course id or slug")
  .action(async (ref: string) => {
    try {
      const course = await getCourse(ref);
      if (globalFlags.format !== "text") {
        output(course);
        return;
      }
      output({
        id: course.id,
        name: course.name,
        slug: course.slug,
        status: course.product.status,
        hidden: course.product.hidden,
        private: course.product.private,
        productId: course.product.id,
        landingPage: course.product.landingPageUrl,
        chapters: course.curriculum.chaptersCount,
        lessons: course.curriculum.lessonsCount,
      });
      console.log();
      output(curriculumRows(course), { fields: ["chapter", "chapterId", "chapterTitle", "position", "lessonId", "lesson", "type", "draft"] });
      for (const warning of truncationWarnings(course)) log.warn(warning);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

coursesResource
  .command("update")
  .description("Change the course's product: name, description, URL slug, status, visibility (Thinkific beta API)")
  .argument("<course>", "Course id or slug")
  .option("--name <name>", "Course name")
  .option("--description <text>", "Course description")
  .option("--slug <slug>", "URL slug of the course pages")
  .option("--status <status>", `Product status: ${STATUSES.join(", ")}`)
  .option("--hidden", "Hide the course from the course catalog")
  .option("--visible", "Show the course in the course catalog")
  .option("--private", "Make the course private (enrolment by admins only)")
  .option("--public", "Make the course purchasable / enrollable again")
  .option("--dry-run", "Print what would be sent, change nothing")
  .action(async (ref: string, opts: Record<string, string | boolean | undefined>) => {
    try {
      if (opts.hidden && opts.visible) throw new CliError(2, "Pass --hidden or --visible, not both");
      if (opts.private && opts.public) throw new CliError(2, "Pass --private or --public, not both");
      const course = await getCourse(ref);
      const input = {
        productId: course.product.id,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.description !== undefined && { description: opts.description }),
        ...(opts.slug !== undefined && { slug: opts.slug }),
        ...(opts.status !== undefined && { status: parseStatuses(String(opts.status))?.[0] }),
        ...((opts.hidden || opts.visible) && { hidden: Boolean(opts.hidden) }),
        ...((opts.private || opts.public) && { private: Boolean(opts.private) }),
      };
      if (Object.keys(input).length === 1) throw new CliError(2, "Nothing to change", "Pass --name, --description, --slug, --status, --hidden/--visible or --private/--public");
      if (opts.dryRun) {
        output({ mutation: "updateProduct", course: course.name, input });
        return;
      }
      const { product } = await mutate<{ product: unknown }>(UPDATE_PRODUCT, "updateProduct", input);
      if (globalFlags.json) output(product);
      else log.success(`Course "${course.name}" updated`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

coursesResource
  .command("duplicate")
  .description("Copy a course with all its chapters and lessons (Thinkific beta API, runs in the background)")
  .argument("<course>", "Course id or slug")
  .action(async (ref: string) => {
    try {
      const course = await getCourse(ref);
      const { message } = await mutate<{ message: string | null }>(DUPLICATE_COURSE, "duplicateCourse", { courseId: course.id });
      if (globalFlags.json) output({ course: course.id, message });
      else log.success(message ?? `Duplication of "${course.name}" started; the copy appears in: esm-thinkific-cli courses list`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

coursesResource
  .command("export")
  .description("Save a course to a folder: course.json (curriculum + every lesson) and the HTML of each lesson that has some")
  .argument("<course>", "Course id or slug")
  .requiredOption("-o, --out <dir>", "Folder to write (created if missing)")
  .addHelpText(
    "after",
    "\nLesson HTML lands in <dir>/lessons/<chapter>-<lesson>-<id>-<title>.html, ready to translate or diff.\nExample:\n  esm-thinkific-cli courses export year-1-quarter-1 -o ./export/y1q1",
  )
  .action(async (ref: string, opts: { out: string }) => {
    try {
      const course = await getCourse(ref);
      const lessonsDir = join(opts.out, "lessons");
      mkdirSync(lessonsDir, { recursive: true });

      const chapters = [];
      let files = 0;
      for (const chapter of chaptersOf(course)) {
        const lessons = [];
        for (const [index, summary] of lessonsOf(chapter).entries()) {
          const lesson = await getLesson(summary.id);
          const html = lesson.content?.htmlDescription;
          let file: string | null = null;
          if (html) {
            file = join("lessons", `${String(chapter.position).padStart(2, "0")}-${String(index).padStart(2, "0")}-${lesson.id}-${slugify(lesson.title)}.html`);
            writeFileSync(join(opts.out, file), html);
            files++;
          }
          const { htmlDescription: _html, ...content } = lesson.content ?? {};
          lessons.push({ ...lesson, content: lesson.content ? content : null, htmlFile: file });
          log.debug(`exported lesson ${lesson.id} ${lesson.title}`);
        }
        chapters.push({ id: chapter.id, title: chapter.title, position: chapter.position, lessons });
      }

      const { curriculum: _curriculum, ...meta } = course;
      writeFileSync(
        join(opts.out, "course.json"),
        `${JSON.stringify({ exportedAt: new Date().toISOString(), course: meta, chapters }, null, 2)}\n`,
      );
      for (const warning of truncationWarnings(course)) log.warn(warning);
      if (globalFlags.json) output({ dir: opts.out, chapters: chapters.length, lessons: course.curriculum.lessonsCount, htmlFiles: files });
      else log.success(`${course.name}: ${chapters.length} chapters, ${files} lesson HTML files in ${opts.out}`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
