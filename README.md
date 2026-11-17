# esm-thinkific-cli

CLI for Thinkific (Encounter's course site), built with the
[api2cli](https://api2cli.dev) structure. Third of the ESM CLIs:
`esm-fto-cli`, `esm-alugha-cli`, `esm-thinkific-cli`.

**FTO mode (default, from 0.2.0):** the CLI runs the FTO app's `thinkific_*`
tools (`POST <app>/api/v1/tools/<name>`) with the user's personal FTO API key,
the one `esm-fto-cli auth set` stores (`~/.config/tokens/esm-fto-cli-<profile>.txt`,
URL in `~/.config/esm-fto-cli/state.json`). The Thinkific site token stays on
the FTO server, FTO checks the role (staff / admin) and only writes to the
courses of its write allowlist. `--fto prod|dev|local` picks the app.

**Direct mode (`--direct`, admins):** the CLI talks to Thinkific's GraphQL API
with the site **API access token**: reads on `https://api.thinkific.com/stable/graphql`,
course content changes on `https://api.thinkific.com/beta/graphql`; `rest`
reaches the REST Admin API v1. `THINKIFIC_API_TOKEN` switches to direct mode.
Needed for `courses update/duplicate`, `chapters get/move/delete`,
`lessons move/copy`, `gql` and `rest`, which have no FTO tool yet.

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

FTO mode: create a key in the FTO app (Account > API keys), then

```bash
esm-fto-cli auth set <key> --profile prod
esm-thinkific-cli auth test
```

Direct mode: a site owner or admin creates the token in Thinkific: **Settings > Code &
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
