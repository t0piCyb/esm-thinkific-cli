/**
 * Every GraphQL operation the CLI sends. Queries run on the stable API,
 * mutations on beta; `test/operations.test.ts` validates each one against
 * `schema/stable.graphql` or `schema/beta.graphql` (`bun run schema` refreshes them).
 */

export const SITE = /* GraphQL */ `
  query CliSite {
    site { id name subdomain url }
    me { id email firstName lastName hasAdminRole }
  }
`;

const USER_ERRORS = "userErrors { code message path }";

// Courses ---------------------------------------------------------------------

export const COURSES = /* GraphQL */ `
  query CliCourses($first: Int!, $after: String, $filter: CourseFilter) {
    site {
      courses(first: $first, after: $after, filter: $filter) {
        nodes {
          id name slug
          product { id status hidden private }
          curriculum { chaptersCount(includeDraftLessons: true) lessonsCount(includeDraftLessons: true) }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/** A course with its whole curriculum (up to 100 chapters of 100 lessons). */
const COURSE_TREE = /* GraphQL */ `
  fragment CliCourseTree on Course {
    id name title slug description
    product { id name status hidden private slug landingPageUrl }
    curriculum {
      chaptersCount(includeDraftLessons: true)
      lessonsCount(includeDraftLessons: true)
      chapters(first: 100, includeDraftLessons: true) {
        nodes {
          id title position
          lessons(first: 100, includeDraftLessons: true) {
            nodes { id title draft lessonType takeUrl }
            pageInfo { hasNextPage }
          }
        }
        pageInfo { hasNextPage }
      }
    }
  }
`;

export const COURSE = /* GraphQL */ `
  query CliCourse($id: ID!) { course(id: $id) { ...CliCourseTree } }
  ${COURSE_TREE}
`;

export const COURSE_BY_SLUG = /* GraphQL */ `
  query CliCourseBySlug($slug: String!) { courseBySlug(slug: $slug) { ...CliCourseTree } }
  ${COURSE_TREE}
`;

export const UPDATE_PRODUCT = /* GraphQL */ `
  mutation CliUpdateProduct($input: UpdateProductInput!) {
    updateProduct(input: $input) {
      product { id name description slug status hidden private }
      ${USER_ERRORS}
    }
  }
`;

export const DUPLICATE_COURSE = /* GraphQL */ `
  mutation CliDuplicateCourse($input: DuplicateCourseInput!) {
    duplicateCourse(input: $input) { message ${USER_ERRORS} }
  }
`;

// Chapters --------------------------------------------------------------------

export const CHAPTER = /* GraphQL */ `
  query CliChapter($id: ID!) {
    chapter(id: $id) {
      id title position
      lessonsCount(includeDraftLessons: true)
      lessons(first: 100, includeDraftLessons: true) {
        nodes { id title draft lessonType }
      }
    }
  }
`;

const CHAPTER_FIELDS = "chapter { id title position }";

export const CREATE_CHAPTER = /* GraphQL */ `
  mutation CliCreateChapter($input: CreateChapterInput!) {
    createChapter(input: $input) { ${CHAPTER_FIELDS} ${USER_ERRORS} }
  }
`;

export const UPDATE_CHAPTER = /* GraphQL */ `
  mutation CliUpdateChapter($input: UpdateChapterInput!) {
    updateChapter(input: $input) { ${CHAPTER_FIELDS} ${USER_ERRORS} }
  }
`;

export const REORDER_CHAPTER = /* GraphQL */ `
  mutation CliReorderChapter($input: ReorderChapterInput!) {
    reorderChapter(input: $input) { ${CHAPTER_FIELDS} ${USER_ERRORS} }
  }
`;

export const REMOVE_CHAPTER = /* GraphQL */ `
  mutation CliRemoveChapter($input: RemoveChapterInput!) {
    removeChapter(input: $input) { ${USER_ERRORS} }
  }
`;

// Lessons ---------------------------------------------------------------------

export const LESSON = /* GraphQL */ `
  query CliLesson($id: ID!) {
    lesson(id: $id) {
      id title draft lessonType takeUrl
      settings { draft free prerequisite label icon }
      chapter { id title position }
      course { id name slug }
      content {
        __typename contentType updatedAt
        ... on TextContent { htmlDescription }
        ... on VideoContent {
          htmlDescription durationInSeconds fileName playUrl videoId
          captions { languageCode languageLabel downloadUrl }
          downloads(first: 50) { nodes { id name url size } }
        }
        ... on DownloadContent { htmlDescription downloads(first: 50) { nodes { id name url size } } }
        ... on PdfContent { url settings { downloadable } }
        ... on AudioContent { htmlDescription url }
        ... on MultimediaContent { url }
        ... on PresentationContent { sourceUrl }
      }
    }
  }
`;

const LESSON_FIELDS = "lesson { id title draft lessonType chapter { id title } }";

export const CREATE_TEXT_LESSON = /* GraphQL */ `
  mutation CliCreateTextLesson($input: CreateTextLessonInput!) {
    createTextLesson(input: $input) { ${LESSON_FIELDS} ${USER_ERRORS} }
  }
`;

export const UPDATE_TEXT_LESSON = /* GraphQL */ `
  mutation CliUpdateTextLesson($input: UpdateTextLessonInput!) {
    updateTextLesson(input: $input) { ${LESSON_FIELDS} ${USER_ERRORS} }
  }
`;

export const REORDER_LESSON = /* GraphQL */ `
  mutation CliReorderLesson($input: ReorderLessonInput!) {
    reorderLesson(input: $input) { ${LESSON_FIELDS} ${USER_ERRORS} }
  }
`;

export const COPY_LESSON = /* GraphQL */ `
  mutation CliCopyLesson($input: CopyLessonInput!) {
    copyLesson(input: $input) { ${LESSON_FIELDS} ${USER_ERRORS} }
  }
`;
