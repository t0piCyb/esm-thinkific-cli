/**
 * FTO mode (default): the CLI runs the FTO app's `thinkific_*` tools
 * (`POST <app>/api/v1/tools/<name>`) with the user's personal FTO API key.
 * The Thinkific site token stays on the FTO server; the app checks the role
 * (staff / admin) and only writes to the courses of its write allowlist.
 *
 * The key and the app URL are the ones `esm-fto-cli` stores, so one
 * `esm-fto-cli auth set <key> --profile prod` serves both CLIs:
 * - key: ESM_FTO_API_KEY, else ~/.config/tokens/esm-fto-cli-<profile>.txt
 * - URL: ESM_FTO_API_URL, else the profile's URL in ~/.config/esm-fto-cli/state.json,
 *   else prod / dev / local
 * - profile: --fto <profile>, else ESM_FTO_PROFILE, else esm-fto-cli's active profile, else prod
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP_CLI, APP_VERSION, globalFlags } from "./config.js";
import { CliError } from "./errors.js";
import { log } from "./logger.js";

const FTO_CLI = "esm-fto-cli";
const FTO_STATE = join(homedir(), ".config", FTO_CLI, "state.json");
const FTO_TOKEN_DIR = join(homedir(), ".config", "tokens");
const TIMEOUT_MS = 120_000;

export const FTO_URLS: Record<string, string> = {
  prod: "https://fto.encounterschool.org",
  dev: "https://fto-dev.encounterschool.org",
  local: "http://localhost:3000",
};

type FtoState = { active?: string; profiles?: Record<string, { url?: string; user?: string; role?: string }> };

const readFtoState = (): FtoState => {
  try {
    return existsSync(FTO_STATE) ? (JSON.parse(readFileSync(FTO_STATE, "utf-8")) as FtoState) : {};
  } catch {
    return {};
  }
};

const safe = (name: string) => name.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || "prod";

export const ftoProfile = (): string =>
  safe(globalFlags.ftoProfile || process.env.ESM_FTO_PROFILE?.trim() || readFtoState().active?.trim() || "prod");

export const ftoUrl = (profile = ftoProfile()): string => {
  const url = process.env.ESM_FTO_API_URL?.trim() || readFtoState().profiles?.[profile]?.url || FTO_URLS[profile];
  if (!url) {
    throw new CliError(
      2,
      `No FTO app URL for profile "${profile}"`,
      `Use --fto prod, dev or local, or set it once: ${FTO_CLI} auth set <key> --profile ${profile} --url <app-url>`,
    );
  }
  return url.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
};

const ftoKey = (profile = ftoProfile()): string => {
  const fromEnv = process.env.ESM_FTO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const path = join(FTO_TOKEN_DIR, `${FTO_CLI}-${profile}.txt`);
  const key = existsSync(path) ? readFileSync(path, "utf-8").trim() : "";
  if (!key) {
    throw new CliError(
      401,
      `No FTO API key for profile "${profile}"`,
      `Create a key in the FTO app (Account > API keys), then: ${FTO_CLI} auth set <key> --profile ${profile}` +
        ` (or use the site token directly: --direct, admins only)`,
    );
  }
  return key;
};

/** Who the FTO profile acts as, as `esm-fto-cli auth set/test` cached it. */
export const ftoProfileOwner = (profile = ftoProfile()) => readFtoState().profiles?.[profile];

/** Runs one FTO tool and returns its JSON answer. */
export async function runTool<T>(name: string, input: Record<string, unknown> = {}): Promise<T> {
  const profile = ftoProfile();
  const url = `${ftoUrl(profile)}/api/v1/tools/${name}`;
  log.debug(`POST ${url}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-api-key": ftoKey(profile),
        "x-tool-source": "cli",
        "x-cli-version": `${APP_CLI}/${APP_VERSION}`,
      },
      body: JSON.stringify(Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CliError(1, `Cannot reach the FTO app (${ftoUrl(profile)}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (res.ok && body) return body;

  const message = body?.error?.message ?? `${res.status} ${res.statusText}`;
  const hints: Record<number, string> = {
    401: `The FTO key of profile "${profile}" is invalid or revoked: ${FTO_CLI} auth set <key> --profile ${profile}`,
    403: "Thinkific tools need the staff or admin role in FTO, and writes only reach the allowlisted courses",
    404:
      name.startsWith("thinkific_") && message.includes("not found. List the tools")
        ? `This FTO app (${ftoUrl(profile)}) has no Thinkific tools yet, or your role cannot see them. Try --fto dev, or --direct`
        : "",
    426: `Update: ${APP_CLI} self-update`,
    503: "The FTO server has no Thinkific token yet (THINKIFIC_API_TOKEN on the backend): ask an admin",
  };
  throw new CliError(res.status, message, hints[res.status] || undefined);
}
