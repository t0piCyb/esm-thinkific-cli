/** Thinkific types as the CLI's operations return them, and lookups shared by the commands. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gql } from "./client.js";
import { BACKUP_DIR, globalFlags } from "./config.js";
import { CliError } from "./errors.js";
import { COURSE, COURSE_BY_SLUG, LESSON } from "./operations.js";
import { runTool } from "./fto.js";

export type LessonSummary = { id: string; title: string; draft: boolean; lessonType: string | null; takeUrl?: string | null };
export type ChapterTree = {
  id: string;
  title: string;
  position: number;
  lessons: { nodes: (LessonSummary | null)[] | null; pageInfo: { hasNextPage: boolean } };
};
export type Product = {
  id: string;
  name: string;
  status: string;
  hidden: boolean;
  private: boolean;
  slug: string | null;
  landingPageUrl: string | null;
};
export type CourseTree = {
  id: string;
  name: string;
  title: string;
  slug: string;
  description: string | null;
  product: Product;
  curriculum: {
    chaptersCount: number;
    lessonsCount: number;
    chapters: { nodes: (ChapterTree | null)[] | null; pageInfo: { hasNextPage: boolean } };
  };
};

type FileRef = { id: string; name: string | null; url: string | null; size: string | null };
export type Lesson = {
  id: string;
  title: string;
  draft: boolean;
  lessonType: string | null;
  takeUrl: string | null;
  settings: { draft: boolean; free: boolean; prerequisite: boolean; label: string; icon: string } | null;
  chapter: { id: string; title: string; position: number } | null;
  course: { id: string; name: string; slug: string } | null;
  content: {
    __typename: string;
    contentType: string;
    updatedAt: string;
    htmlDescription?: string | null;
    url?: string | null;
    sourceUrl?: string | null;
    playUrl?: string | null;
    videoId?: string | null;
    fileName?: string | null;
    durationInSeconds?: number | null;
    captions?: { languageCode: string | null; languageLabel: string | null; downloadUrl: string | null }[] | null;
    downloads?: { nodes: (FileRef | null)[] | null } | null;
    settings?: { downloadable: boolean };
  } | null;
};

/** A course by id, or by slug when no course has that id. */
async function getCourseDirect(ref: string): Promise<CourseTree> {
  const byId = await gql<{ course: CourseTree | null }>(COURSE, { id: ref }).catch((err: unknown) => {
    // Thinkific answers an id it cannot parse (a slug) with an error, not null.
    if (err instanceof CliError && err.code !== 401 && err.code !== 429) return { course: null };
    throw err;
  });
  if (byId.course) return byId.course;
  const { courseBySlug } = await gql<{ courseBySlug: CourseTree | null }>(COURSE_BY_SLUG, { slug: ref });
  if (!courseBySlug) throw new CliError(404, `No Thinkific course with id or slug "${ref}"`, "List them: esm-thinkific-cli courses list");
  return courseBySlug;
}

async function getLessonDirect(id: string): Promise<Lesson> {
  const { lesson } = await gql<{ lesson: Lesson | null }>(LESSON, { id });
  if (!lesson) throw new CliError(404, `No Thinkific lesson ${id}`, "Find lesson ids with: esm-thinkific-cli courses get <course>");
  return lesson;
}

// FTO mode (default) or direct mode ---------------------------------------------

/**
 * Direct mode = the Thinkific site token (`--direct`, or THINKIFIC_API_TOKEN
 * set). Otherwise the CLI goes through the FTO app's `thinkific_*` tools with
 * the user's FTO key (src/lib/fto.ts).
 */
export const isDirect = () => globalFlags.direct || Boolean(process.env.THINKIFIC_API_TOKEN?.trim());

/** Commands with no FTO tool yet: admins run them with the site token. */
export function requireDirect(command: string): void {
  if (isDirect()) return;
  throw new CliError(
    2,
    `"${command}" is not available through FTO yet`,
    "Admins with the Thinkific site token: add --direct (esm-thinkific-cli auth login first)",
  );
}

/** `thinkific_get_course` answer (FTO backend, snake_case). */
type FtoCourse = {
  id: string;
  name: string;
  slug: string;
  status: string | null;
  hidden: boolean | null;
  private: boolean | null;
  landing_page_url: string | null;
  writable: boolean;
  warnings: string[];
  chapters: {
    id: string;
    title: string;
    position: number;
    lessons: { id: string; title: string; type: string | null; draft: boolean; take_url: string | null }[];
  }[];
};

/** `thinkific_get_lesson` answer. */
type FtoLesson = {
  id: string;
  title: string;
  type: string | null;
  draft: boolean;
  take_url: string | null;
  settings: { draft: boolean; free: boolean; prerequisite: boolean } | null;
  chapter: { id: string; title: string; position: number } | null;
  course: { id: string; name: string; slug: string } | null;
  html: string | null;
  content_type: string | null;
  updated_at: string | null;
  url: string | null;
  files: { id: string; name: string | null; url: string | null }[];
  captions: { languageCode: string | null; languageLabel: string | null }[];
};

const fromFtoCourse = (c: FtoCourse): CourseTree & { writable: boolean } => ({
  id: c.id,
  name: c.name,
  title: c.name,
  slug: c.slug,
  description: null,
  writable: c.writable,
  product: {
    id: "",
    name: c.name,
    status: c.status ?? "",
    hidden: Boolean(c.hidden),
    private: Boolean(c.private),
    slug: c.slug,
    landingPageUrl: c.landing_page_url,
  },
  curriculum: {
    chaptersCount: c.chapters.length,
    lessonsCount: c.chapters.reduce((n, ch) => n + ch.lessons.length, 0),
    chapters: {
      nodes: c.chapters.map((ch) => ({
        id: ch.id,
        title: ch.title,
        position: ch.position,
        lessons: {
          nodes: ch.lessons.map((l) => ({ id: l.id, title: l.title, draft: l.draft, lessonType: l.type, takeUrl: l.take_url })),
          pageInfo: { hasNextPage: c.warnings.some((w) => w.includes(`"${ch.title}"`)) },
        },
      })),
      pageInfo: { hasNextPage: c.warnings.some((w) => w.includes("100 chapters")) },
    },
  },
});

const fromFtoLesson = (l: FtoLesson): Lesson => ({
  id: l.id,
  title: l.title,
  draft: l.draft,
  lessonType: l.type,
  takeUrl: l.take_url,
  settings: l.settings ? { ...l.settings, label: "", icon: "" } : null,
  chapter: l.chapter,
  course: l.course,
  content: {
    __typename: "",
    contentType: l.content_type ?? "",
    updatedAt: l.updated_at ?? "",
    htmlDescription: l.html,
    url: l.url,
    captions: l.captions.map((c) => ({ ...c, downloadUrl: null })),
    downloads: { nodes: l.files.map((f) => ({ ...f, size: null })) },
  },
});

/** A course by id, or by slug when no course has that id. */
export async function getCourse(ref: string): Promise<CourseTree> {
  if (isDirect()) return getCourseDirect(ref);
  return fromFtoCourse(await runTool<FtoCourse>("thinkific_get_course", { course: ref }));
}

export async function getLesson(id: string): Promise<Lesson> {
  if (isDirect()) return getLessonDirect(id);
  return fromFtoLesson(await runTool<FtoLesson>("thinkific_get_lesson", { lesson: id }));
}

/** Writes the previous HTML the FTO tool returned, like the direct mode backup. */
export function backupHtml(lessonId: string, html: string | null | undefined): string | null {
  if (html === undefined || html === null) return null;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = join(BACKUP_DIR, `${lessonId}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
  writeFileSync(path, html);
  return path;
}

export const chaptersOf = (course: CourseTree): ChapterTree[] =>
  (course.curriculum.chapters.nodes ?? []).filter((c): c is ChapterTree => c !== null).sort((a, b) => a.position - b.position);

export const lessonsOf = (chapter: ChapterTree): LessonSummary[] =>
  (chapter.lessons.nodes ?? []).filter((l): l is LessonSummary => l !== null);

/** One row per lesson, in curriculum order: what `courses get` prints. */
export const curriculumRows = (course: CourseTree) =>
  chaptersOf(course).flatMap((chapter) =>
    lessonsOf(chapter).map((lesson, index) => ({
      chapter: chapter.position,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      position: index,
      lessonId: lesson.id,
      lesson: lesson.title,
      type: lesson.lessonType,
      draft: lesson.draft,
    })),
  );

/** The curriculum is read in one request; past 100 chapters or lessons it is cut. */
export const truncationWarnings = (course: CourseTree): string[] => [
  ...(course.curriculum.chapters.pageInfo.hasNextPage ? [`Only the first 100 chapters of "${course.name}" are shown.`] : []),
  ...chaptersOf(course)
    .filter((c) => c.lessons.pageInfo.hasNextPage)
    .map((c) => `Only the first 100 lessons of chapter "${c.title}" are shown.`),
];

/** Keeps the lesson's HTML before it is overwritten, so a bad write can be undone. */
export const backupLessonHtml = (lesson: Lesson): string | null => backupHtml(lesson.id, lesson.content?.htmlDescription);

/** Filesystem-safe name for exported lesson files. */
export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "lesson";
