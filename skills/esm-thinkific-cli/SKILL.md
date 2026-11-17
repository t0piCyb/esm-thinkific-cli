---
name: esm-thinkific-cli
description: "Operate Encounter's Thinkific course site with esm-thinkific-cli: list courses, read a course's chapters and lessons, read or export lesson HTML, create and edit text lessons (HTML), create/rename/reorder chapters, move or copy lessons, change a course's name/status/visibility, duplicate a course, or call any Thinkific GraphQL or REST endpoint. Use when the user talks about Thinkific, course pages, lessons or chapters on the course site (for videos use esm-alugha-cli, for the translation workflow esm-fto-cli)."
category: "productivity"
---

# esm-thinkific-cli

CLI for Thinkific, the site where Encounter's courses are taught. By default
it goes through the **FTO app** (its `thinkific_*` tools) with the user's own
**FTO API key**: the Thinkific site token stays on the FTO server, FTO checks
the role (staff or admin) and only writes to allowlisted courses (dev: the
test course 3512623). Every write is visible to students unless the lesson or
course is a draft.

## Setup

```bash
esm-thinkific-cli auth test         # FTO app, user, role, Thinkific reachable
```

It uses the key `esm-fto-cli` stores. If there is none, ask the user to create
one in the FTO app (Account > API keys) and run, themselves:

```bash
esm-fto-cli auth set <key> --profile prod
```

`--fto dev` (or `local`) targets another FTO app; `ESM_FTO_PROFILE`,
`ESM_FTO_API_KEY` and `ESM_FTO_API_URL` override the stored profile, key and URL.

**Direct mode (admins only):** `--direct` uses the Thinkific site token
(`auth login --profile encounter`, prompted, never pasted in a chat; or
`THINKIFIC_API_TOKEN`, which switches to direct mode by itself). Only needed
for the commands FTO does not have yet: `courses update/duplicate`,
`chapters get/move/delete`, `lessons move/copy`, `gql`, `rest`.

## References

- **Course**: id or slug (`courses list` shows both).
- **Chapter / lesson**: ids shown by `courses get <course>`; positions start at
  the values shown there.

## Commands

```bash
# Courses
esm-thinkific-cli courses list [--search "Year 1"] [--status PUBLISHED|DRAFT] [--archived]
esm-thinkific-cli courses get <course>                 # chapters + lessons (ids, type, draft)
esm-thinkific-cli courses export <course> -o <dir>     # course.json + lessons/*.html

# Chapters
esm-thinkific-cli chapters create <course> --name "Session 4" [--position n] [--dry-run]
esm-thinkific-cli chapters rename <chapter-id> --course <course> --name "..." [--dry-run]

# Lessons
esm-thinkific-cli lessons get <lesson-id>              # type, settings, media URLs, files, captions
esm-thinkific-cli lessons html <lesson-id> [-o lesson.html]
esm-thinkific-cli lessons create <chapter-id> --course <course> --name "..." -f page.html [--publish] [--position n] [--dry-run]
esm-thinkific-cli lessons update <lesson-id> [-f page.html | --html "..."] [--name "..."] [--draft|--publish] [--dry-run]

# Direct mode only (--direct, Thinkific site token, admins)
esm-thinkific-cli --direct courses update <course> [--name] [--description] [--slug] [--status] [--hidden|--visible] [--private|--public] [--dry-run]
esm-thinkific-cli --direct courses duplicate <course>
esm-thinkific-cli --direct chapters get <chapter-id>
esm-thinkific-cli --direct chapters move <chapter-id> --course <course> --to <n>
esm-thinkific-cli --direct chapters delete <chapter-id> --yes   # deletes its lessons too
esm-thinkific-cli --direct lessons move <lesson-id> --chapter <chapter-id> --to <n>
esm-thinkific-cli --direct lessons copy <lesson-id> --chapter <chapter-id> [--position n]
esm-thinkific-cli --direct gql 'query Site { site { name url } }' [--vars '{...}']
esm-thinkific-cli --direct rest GET 'enrollments?query[course_id]=123&limit=25'
```

Global flags: `--fto <prod|dev|local>`, `--direct`, `-p/--profile` (token
profile, direct mode), `--json`, `--format <text|json|csv|yaml>`, `--verbose`,
`--no-color`, `--no-header`.

Errors from FTO: 403 = not staff/admin, course outside the write allowlist, or
not a TEXT lesson; 503 = the FTO server has no Thinkific token yet. Report
them, do not switch to `--direct` on your own.

## What is not possible through the API

Thinkific's API cannot upload files or edit **video, PDF, download, audio,
quiz or survey lessons** (read only). Only **text lessons** take new HTML. To
publish a handout or slides, link the Google Drive file from a text lesson,
or ask the user to change the lesson in the Thinkific editor. Say so instead of
trying workarounds.

## Guard rails

- **Test on the test lesson first.** Encounter has a test lesson for this;
  never try a new kind of change on a live course. Ask which lesson is the test
  one if you do not know.
- Run every write with `--dry-run` first when it exists, and show the user what
  will change. New lessons are drafts unless `--publish`; publish after review.
  Thinkific's API cannot delete a lesson, so a wrong `lessons create` stays
  until someone removes it in the Thinkific editor.
- `lessons update` saves the previous HTML in
  `~/.cache/esm-thinkific-cli/backups/<lesson-id>-<time>.html`; to undo,
  `lessons update <id> -f <backup>`.
- `courses export` before a large change, so the course can be rebuilt.
- `chapters delete` removes the lessons inside: confirm with the user, then `--yes`.
- Content writes use Thinkific's **beta** API. If one fails with an unknown
  field or argument, the beta changed: report it, do not guess another mutation.

## Updates

Once a day esm-thinkific-cli checks GitHub for a newer version. When a command prints
**Update available** on stderr (or `meta.update` in `--json` output), or an
error says the CLI is too old: tell the user, run `esm-thinkific-cli self-update`, re-read
this skill (it is updated with the CLI), then run the command again.
`esm-thinkific-cli self-update --check` checks right away.
