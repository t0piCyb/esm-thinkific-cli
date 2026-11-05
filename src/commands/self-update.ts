import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { APP_CLI, globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { log } from "../lib/logger.js";
import { output } from "../lib/output.js";
import { git, installDir, isBehind, remoteHead, saveCheck } from "../lib/update.js";

/** Runs bun (the runtime running this CLI) in the checkout; throws with its output on failure. */
function bun(root: string, args: string[]): void {
  const res = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 300_000 });
  if (res.status !== 0) {
    throw new CliError(1, `bun ${args.join(" ")} failed:\n${(res.stderr || res.stdout).trim().slice(-1500)}`);
  }
}

export const selfUpdateCommand = new Command("self-update")
  .description(`Update ${APP_CLI} (and its agent skill) to the latest version from GitHub`)
  .option("--check", "Only check GitHub now, install nothing")
  .addHelpText("after", `\nPulls main into the CLI's folder, then reinstalls and rebuilds it.`)
  .action((opts: { check?: boolean }) => {
    try {
      const root = installDir();
      if (!root || !existsSync(join(root, ".git"))) {
        throw new CliError(2, `${APP_CLI} is not a git checkout, so it cannot update itself`, "Reinstall it: https://esm-mcp.topilo.dev/#cli-install");
      }
      const before = git(root, ["rev-parse", "HEAD"]);
      const remote = remoteHead(root);
      if (!before) throw new CliError(1, `Cannot read the current version in ${root}`);
      if (!remote) throw new CliError(1, "Cannot reach GitHub to check for updates");
      saveCheck(remote);
      const behind = isBehind(root, remote);

      if (opts.check || !behind) {
        output({ cli: APP_CLI, current: before.slice(0, 7), latest: remote.slice(0, 7), updateAvailable: behind, folder: root });
        return;
      }

      if (git(root, ["status", "--porcelain", "--untracked-files=no"])) {
        throw new CliError(2, `Local changes in ${root}`, "Commit or stash them, then run self-update again");
      }
      if (git(root, ["pull", "--ff-only", "origin", "main"], 120_000) === null) {
        throw new CliError(1, `git pull failed in ${root}`, `Run it there by hand: git -C ${root} pull --ff-only origin main`);
      }
      bun(root, ["install"]);
      bun(root, ["run", "build"]);
      chmodSync(join(root, "dist", "index.js"), 0o755);

      const after = git(root, ["rev-parse", "HEAD"]) ?? remote;
      const changes = (git(root, ["log", "--format=%h %s", `${before}..${after}`]) ?? "").split("\n").filter(Boolean);
      if (globalFlags.json || globalFlags.format !== "text") {
        output({ cli: APP_CLI, from: before.slice(0, 7), to: after.slice(0, 7), changes });
        return;
      }
      log.success(`${APP_CLI} updated ${before.slice(0, 7)} -> ${after.slice(0, 7)}`);
      for (const change of changes) log.info(`  ${change}`);
      log.info(`The agent skill is updated too: re-read skills/${APP_CLI}/SKILL.md.`);
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
