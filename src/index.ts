#!/usr/bin/env bun
import { Command } from "commander";
import { selfUpdateCommand } from "./commands/self-update.js";
import { authCommand } from "./commands/auth.js";
import { gqlCommand, restCommand } from "./commands/raw.js";
import { globalFlags } from "./lib/config.js";
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
    "Thinkific CLI for Encounter ESM: courses, chapters, lessons, lesson HTML, export.\nUses a Thinkific API access token (GraphQL: stable for reads, beta for content changes).",
  )
  .version("0.1.0")
  .option("-p, --profile <name>", "Site profile (default: THINKIFIC_PROFILE, then the active profile)")
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
  esm-thinkific-cli auth login --profile encounter
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
