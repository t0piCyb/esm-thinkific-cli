#!/usr/bin/env bun
import { Command } from "commander";
import { selfUpdateCommand } from "./commands/self-update.js";
import { authCommand } from "./commands/auth.js";
import { gqlCommand, restCommand } from "./commands/raw.js";
import { APP_VERSION, globalFlags } from "./lib/config.js";
import { notifyUpdate } from "./lib/update.js";
import { defaultProfile } from "./lib/session.js";
import { chaptersResource } from "./resources/chapters.js";
import { coursesResource } from "./resources/courses.js";
import { lessonsResource } from "./resources/lessons.js";

// `esm-thinkific-cli lessons html ... | head` closes stdout early: exit quietly.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

const program = new Command();

program
  .name("esm-thinkific-cli")
  .description(
    "Thinkific CLI for Encounter ESM: courses, chapters, lessons, lesson HTML, export.\nGoes through the FTO app with your FTO API key (the same as esm-fto-cli): the Thinkific token stays on the FTO server.\nAdmins can use the Thinkific site token directly with --direct.",
  )
  .version(APP_VERSION)
  .option("--fto <profile>", "FTO app: prod, dev, local or an esm-fto-cli profile (default: ESM_FTO_PROFILE, then esm-fto-cli's active profile)")
  .option("--direct", "Use the Thinkific site token (auth login) instead of FTO; automatic when THINKIFIC_API_TOKEN is set", false)
  .option("-p, --profile <name>", "Thinkific token profile for --direct (default: THINKIFIC_PROFILE, then the active profile)")
  .option("--json", "Output as JSON", false)
  .option("--format <fmt>", "Output format: text, json, csv, yaml", "text")
  .option("--verbose", "Enable debug logging (requests, rate-limit cost)", false)
  .option("--no-color", "Disable colored output")
  .option("--no-header", "Omit table/csv headers (for piping)")
  .addHelpText(
    "after",
    `
Courses are referenced by id or slug; chapters and lessons by the ids that \`courses get\` shows.

Quick start:
  esm-fto-cli auth set <key> --profile prod     # once: your FTO API key (Account > API keys)
  esm-thinkific-cli auth test
  esm-thinkific-cli courses list
  esm-thinkific-cli courses get <course>
  esm-thinkific-cli lessons html <lesson-id> -o lesson.html
  esm-thinkific-cli lessons update <lesson-id> -f lesson.html --dry-run
  esm-thinkific-cli courses export <course> -o ./export`,
  )
  .hook("preAction", (_thisCmd, actionCmd) => {
    const root = actionCmd.optsWithGlobals();
    globalFlags.json = root.json ?? false;
    globalFlags.format = root.json ? "json" : (root.format ?? "text");
    globalFlags.verbose = root.verbose ?? false;
    globalFlags.noColor = root.color === false;
    globalFlags.noHeader = root.header === false;
    globalFlags.profile = root.profile ?? defaultProfile();
    globalFlags.ftoProfile = root.fto ?? "";
    globalFlags.direct = root.direct ?? false;
    if (actionCmd.name() !== "self-update") notifyUpdate();
  });

program.addCommand(authCommand);
program.addCommand(coursesResource);
program.addCommand(chaptersResource);
program.addCommand(lessonsResource);
program.addCommand(gqlCommand);
program.addCommand(restCommand);
program.addCommand(selfUpdateCommand);

program.parse();
