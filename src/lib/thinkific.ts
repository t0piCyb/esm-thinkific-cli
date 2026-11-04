/** Thinkific types as the CLI's operations return them, and lookups shared by the commands. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gql } from "./client.js";
import { BACKUP_DIR } from "./config.js";
import { CliError } from "./errors.js";
import { COURSE, COURSE_BY_SLUG, LESSON } from "./operations.js";

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
export async function getCourse(ref: string): Promise<CourseTree> {
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

export async function getLesson(id: string): Promise<Lesson> {
  const { lesson } = await gql<{ lesson: Lesson | null }>(LESSON, { id });
  if (!lesson) throw new CliError(404, `No Thinkific lesson ${id}`, "Find lesson ids with: esm-thinkific-cli courses get <course>");
  return lesson;
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
export function backupLessonHtml(lesson: Lesson): string | null {
  const html = lesson.content?.htmlDescription;
  if (html === undefined || html === null) return null;
  mkdirSync(BACKUP_DIR, { recursive: true });
  const path = join(BACKUP_DIR, `${lesson.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.html`);
  writeFileSync(path, html);
  return path;
}

/** Filesystem-safe name for exported lesson files. */
export const slugify = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "lesson";
