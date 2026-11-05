/**
 * Update check, shared by the ESM CLIs (esm-fto-cli, esm-alugha-cli,
 * esm-thinkific-cli): at most once a day, compares this checkout with `main`
 * on GitHub (public repositories, no sign-in) and tells the user and the AI
 * agent reading stderr to run `<cli> self-update`. Never blocks a command:
 * offline or outside a git checkout, it says nothing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { APP_CLI } from "./config.js";

const BRANCH = "main";
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = join(homedir(), ".config", APP_CLI, "update-check.json");

type Cache = { checkedAt: string; remote: string | null };
export type UpdateInfo = { current: string; latest: string; command: string };

/** Set by `checkForUpdate`, added to `--json` output as `meta.update`. */
export const updateState: { available: UpdateInfo | null } = { available: null };

/** Runs git in `cwd`; returns trimmed stdout, or null on failure or timeout. */
export function git(cwd: string, args: string[], timeoutMs = 5_000): string | null {
  const res = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: timeoutMs });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** Folder of this checkout: the one with our package.json, above dist/ or src/lib/. */
export function installDir(): string | null {
  let dir = import.meta.dir;
  for (let depth = 0; depth < 4; depth++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === APP_CLI) return dir;
      } catch {
        return null;
      }
    }
    dir = dirname(dir);
  }
  return null;
}

/** Latest commit of `main` on GitHub, or null when unreachable. */
export const remoteHead = (root: string): string | null =>
  git(root, ["ls-remote", "origin", `refs/heads/${BRANCH}`])?.split(/\s+/)[0] || null;

export function saveCheck(remote: string | null): void {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, `${JSON.stringify({ checkedAt: new Date().toISOString(), remote } satisfies Cache)}\n`);
  } catch {
    // A read-only home only means checking again next time.
  }
}

function readCheck(): Cache | null {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Cache;
  } catch {
    return null;
  }
}

/**
 * True when `remote` is a commit this checkout does not contain: unknown
 * locally (newer, not fetched yet) or not an ancestor of HEAD. A checkout ahead
 * of GitHub (unpushed work) is not behind.
 */
export function isBehind(root: string, remote: string): boolean {
  const head = git(root, ["rev-parse", "HEAD"]);
  if (!head || head === remote) return false;
  if (git(root, ["cat-file", "-e", `${remote}^{commit}`]) === null) return true;
  return git(root, ["merge-base", "--is-ancestor", remote, "HEAD"]) === null;
}

/** Checks (from the daily cache, or GitHub when it is stale) whether an update is waiting. */
export function checkForUpdate(): UpdateInfo | null {
  if (process.env.ESM_CLI_NO_UPDATE_CHECK || process.env.CI) return null;
  const root = installDir();
  if (!root || !existsSync(join(root, ".git"))) return null;

  const cache = readCheck();
  let remote = cache?.remote ?? null;
  if (!cache || Date.now() - Date.parse(cache.checkedAt) > CHECK_EVERY_MS) {
    remote = remoteHead(root) ?? remote;
    saveCheck(remote);
  }
  if (!remote || !isBehind(root, remote)) return null;

  updateState.available = {
    current: git(root, ["rev-parse", "--short", "HEAD"]) ?? "?",
    latest: remote.slice(0, 7),
    command: `${APP_CLI} self-update`,
  };
  return updateState.available;
}

/** Tells the user and their agent, on stderr, so stdout (JSON, SRT, HTML) stays clean. */
export function notifyUpdate(): void {
  const update = checkForUpdate();
  if (!update) return;
  console.error(
    `${pc.yellow("Update available")} for ${APP_CLI} (${update.current} -> ${update.latest}). Run: ${update.command}\n` +
      pc.dim(`AI agents: tell the user, run \`${update.command}\`, re-read the ${APP_CLI} skill, then continue.`),
  );
}
