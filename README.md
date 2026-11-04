# esm-thinkific-cli

CLI for Thinkific (Encounter's course site), built with the
[api2cli](https://api2cli.dev) structure. Third of the ESM CLIs:
`esm-fto-cli`, `esm-alugha-cli`, `esm-thinkific-cli`.

It talks to Thinkific's GraphQL API with a site **API access token**:
reads on `https://api.thinkific.com/stable/graphql`, course content changes
(chapters, text lessons) on `https://api.thinkific.com/beta/graphql`, the only
API that has them. `rest` reaches the REST Admin API v1 with the same token.

## What the Thinkific API allows (November 2026)

| Need | API | Command |
|---|---|---|
| Courses, chapters, lessons, lesson HTML, PDF/download/video URLs, captions | stable (read) | `courses list/get/export`, `chapters get`, `lessons get/html` |
| Course name, description, slug, status, hidden, private | beta `updateProduct` | `courses update` |
| Duplicate a course | beta `duplicateCourse` | `courses duplicate` |
| Create, rename, reorder, delete chapters | beta | `chapters create/rename/move/delete` |
| Create and edit **text** lessons (HTML), draft/published | beta | `lessons create/update` |
| Move or copy any lesson | beta | `lessons move/copy` |
| Users, enrollments, orders, groups | REST v1 | `rest` |
| Upload a PDF, video or download file; edit a PDF/video/download/quiz lesson | **none** | not possible: link Drive files from a text lesson, or do it in the Thinkific editor |

The beta API may change without notice: `bun run schema` refreshes
`schema/*.graphql` and `bun test` shows which command a change breaks.
Thinkific limits each site to 2000 cost points per minute and 100 items per page;
the CLI waits once when it is rate limited.

## Install

```bash
bun install && bun run build
ln -sf "$PWD/dist/index.js" ~/.local/bin/esm-thinkific-cli
ln -s "$PWD/skills/esm-thinkific-cli" ~/.claude/skills/esm-thinkific-cli
```

## Configure

A site owner or admin creates the token in Thinkific: **Settings > Code &
analytics > API access tokens > Add API access token** (shown once, with an
expiry date). The site's plan must include API access (Grow or above).

```bash
esm-thinkific-cli auth login --profile encounter --expires 2027-02-01   # token prompted, not echoed
esm-thinkific-cli auth test
```

Tokens: `~/.config/tokens/esm-thinkific-cli-<profile>.json` (chmod 600).
`THINKIFIC_API_TOKEN` overrides them (agents, CI, MCP gateway).

## Usage

See `skills/esm-thinkific-cli/SKILL.md` (also used by AI agents).

## Develop

```bash
bun test          # operations validated against the schema + CLI against a fake API
bun run ts        # type check
bun run schema    # refresh schema/stable.graphql and schema/beta.graphql
```

## Layout

- `src/lib/operations.ts` - every GraphQL operation (validated by `test/operations.test.ts`)
- `src/lib/client.ts` - GraphQL (stable/beta) and REST client, userErrors, pagination, rate limit
- `src/lib/thinkific.ts` - course/lesson lookups, curriculum rows, HTML backups
- `src/resources/` - courses, chapters, lessons
- `src/commands/` - auth, raw `gql` and `rest`
