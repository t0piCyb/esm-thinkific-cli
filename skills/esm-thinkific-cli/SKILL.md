---
name: esm-thinkific-cli
description: "Operate Encounter's Thinkific course site with esm-thinkific-cli: list courses, read a course's chapters and lessons, read or export lesson HTML, create and edit text lessons (HTML), create/rename/reorder chapters, move or copy lessons, change a course's name/status/visibility, duplicate a course, or call any Thinkific GraphQL or REST endpoint. Use when the user talks about Thinkific, course pages, lessons or chapters on the course site (for videos use esm-alugha-cli, for the translation workflow esm-fto-cli)."
category: "productivity"
---

# esm-thinkific-cli

Direct CLI for Thinkific, the site where Encounter's courses are taught. It
uses the site's **API access token** and acts with full admin rights on the
whole site: every write is visible to students unless the lesson is a draft.

## Setup

```bash
esm-thinkific-cli auth test         # which site, token expiry
esm-thinkific-cli auth list         # stored tokens (* = active)
```

If no token is stored, ask the user to log in themselves (the token is
prompted, never pasted in a chat). They create it in Thinkific: Settings >
Code & analytics > API access tokens.

```bash
esm-thinkific-cli auth login --profile encounter --expires <yyyy-mm-dd>
```

`THINKIFIC_API_TOKEN` overrides the stored profiles (agents, CI).

## References

- **Course**: id or slug (`courses list` shows both).
- **Chapter / lesson**: ids shown by `courses get <course>`; positions start at
  the values shown there.

## Commands

```bash
# Courses
esm-thinkific-cli courses list [--search "Year 1"] [--status PUBLISHED,DRAFT] [--archived]
esm-thinkific-cli courses get <course>                 # chapters + lessons (ids, type, draft)
esm-thinkific-cli courses export <course> -o <dir>     # course.json + lessons/*.html
esm-thinkific-cli courses update <course> [--name] [--description] [--slug] [--status DRAFT|PUBLISHED] [--hidden|--visible] [--private|--public] [--dry-run]
esm-thinkific-cli courses duplicate <course>           # copy of the whole course (background job)

# Chapters
esm-thinkific-cli chapters get <chapter-id>
esm-thinkific-cli chapters create <course> --name "Session 4" [--position n]
esm-thinkific-cli chapters rename <chapter-id> --name "..."
esm-thinkific-cli chapters move <chapter-id> --course <course> --to <n>
esm-thinkific-cli chapters delete <chapter-id> --yes   # deletes its lessons too

# Lessons
esm-thinkific-cli lessons get <lesson-id>              # type, settings, media URLs, files, captions
esm-thinkific-cli lessons html <lesson-id> [-o lesson.html]
esm-thinkific-cli lessons create <chapter-id> --name "..." -f page.html [--draft] [--free] [--position n] [--dry-run]
esm-thinkific-cli lessons update <lesson-id> [-f page.html | --html "..."] [--name "..."] [--draft|--publish] [--dry-run]
esm-thinkific-cli lessons move <lesson-id> --chapter <chapter-id> --to <n>
esm-thinkific-cli lessons copy <lesson-id> --chapter <chapter-id> [--position n]

# Anything else
esm-thinkific-cli gql 'query Site { site { name url } }' [--vars '{...}'] [--beta|--stable]
esm-thinkific-cli rest GET 'enrollments?query[course_id]=123&limit=25'
```

Global flags: `-p/--profile`, `--json`, `--format <text|json|csv|yaml>`,
`--verbose` (shows each request's rate-limit cost), `--no-color`, `--no-header`.

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
  will change. Create new lessons with `--draft`, publish after review.
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
