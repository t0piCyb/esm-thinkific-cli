/**
 * Activity log: every Thinkific operation the CLI runs with the site token (--direct) is reported to the FTO
 * app (`POST <app>/api/v1/activity/report`), which records who did what, from
 * where, and posts writes and failures to the team's Discord channel.
 *
 * The report is signed with the user's FTO API key, the one `esm-fto-cli`
 * stores, so the FTO app knows the person behind the shared site token:
 * - key: ESM_FTO_API_KEY, else ~/.config/tokens/esm-fto-cli-<profile>.txt
 * - URL: ESM_FTO_API_URL, else the profile's URL in ~/.config/esm-fto-cli/state.json, else prod / dev / local
 * - profile: ESM_FTO_PROFILE, else esm-fto-cli's active profile, else prod
 * Without an FTO key nothing is reported (run `esm-fto-cli auth set <key>`).
 * A report never fails a command.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json";
import { APP_CLI } from "./config.js";
import { log } from "./logger.js";

const FTO_CLI = "esm-fto-cli";
const FTO_URLS: Record<string, string> = {
  prod: "https://fto.encounterschool.org",
  dev: "https://fto-dev.encounterschool.org",
  local: "http://localhost:3000",
};
const REPORT_TIMEOUT_MS = 3000;
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie/i;

type FtoState = { active?: string; profiles?: Record<string, { url?: string }> };

const readFtoState = (): FtoState => {
  try {
    const path = join(homedir(), ".config", FTO_CLI, "state.json");
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as FtoState) : {};
  } catch {
    return {};
  }
};

/** FTO app URL and API key to report with, or null when the user has none. */
const ftoTarget = (): { url: string; key: string } | null => {
  const state = readFtoState();
  const profile = (process.env.ESM_FTO_PROFILE?.trim() || state.active?.trim() || "prod").replace(/[^a-zA-Z0-9._-]/g, "_");
  const url = process.env.ESM_FTO_API_URL?.trim() || state.profiles?.[profile]?.url || FTO_URLS[profile];
  const keyPath = join(homedir(), ".config", "tokens", `${FTO_CLI}-${profile}.txt`);
  const key = process.env.ESM_FTO_API_KEY?.trim() || (existsSync(keyPath) ? readFileSync(keyPath, "utf-8").trim() : "");
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, "").replace(/\/api\/v1$/, ""), key };
};

/** `esm-thinkific-cli/0.2.0 (host)`: stored by the FTO app as the client. */
export const toolClient = () => `${APP_CLI}/${pkg.version} (${hostname()})`;

/** Secrets replaced, long strings (SRT) shortened, like the FTO app does. */
const redact = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return value.length > 300 ? `${value.slice(0, 300)}… (${value.length} chars)` : value;
  if (!value || typeof value !== "object") return value;
  if (depth >= 4) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
};

/** The command line, without the values of secret flags. */
const commandLine = () => {
  const args = process.argv.slice(2);
  return args.map((arg, i) => (i > 0 && /^--?(password|token|key)/i.test(args[i - 1] ?? "") ? "[redacted]" : arg)).join(" ");
};

const operationOf = (query: string) => {
  const match = query.match(/^\s*(query|mutation)\s+(\w+)/);
  return { name: match?.[2] ?? "anonymous", access: match?.[1] === "mutation" ? ("write" as const) : ("read" as const) };
};

type Outcome = { startedAt: number; error?: unknown; actingAs?: string };

/** Reports one GraphQL operation (name and read / write from the document). */
export const reportOperation = (query: string, variables: Record<string, unknown>, outcome: Outcome) =>
  reportActivity(operationOf(query), variables, outcome);

/** Reports one REST Admin API call: `GET users`, `POST enrollments`. */
export const reportRest = (method: string, path: string, body: unknown, outcome: Outcome) =>
  reportActivity(
    { name: `${method.toUpperCase()} ${path.replace(/^\/+/, "").split("?")[0]}`, access: method.toUpperCase() === "GET" ? "read" : "write" },
    body === undefined ? {} : { body },
    outcome,
  );

/**
 * Reports one call. Writes and failures are awaited (a failure ends the
 * process right after); successful reads are sent in the background.
 */
async function reportActivity(
  { name, access }: { name: string; access: "read" | "write" },
  variables: Record<string, unknown>,
  outcome: Outcome,
) {
  const target = ftoTarget();
  if (!target) {
    log.debug("No FTO API key: the activity is not reported to the FTO app");
    return;
  }
  const error = outcome.error;
  const send = fetch(`${target.url}/api/v1/activity/report`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-api-key": target.key,
      "x-tool-source": "cli",
      "x-tool-client": toolClient(),
    },
    body: JSON.stringify({
      service: "thinkific",
      action: name,
      access,
      input: { command: commandLine(), variables: redact(variables) },
      ok: !error,
      errorStatus: error && typeof (error as { code?: unknown }).code === "number" && (error as { code: number }).code >= 400 ? (error as { code: number }).code : undefined,
      errorMessage: error ? (error instanceof Error ? error.message : String(error)).slice(0, 4000) : undefined,
      durationMs: Date.now() - outcome.startedAt,
      actingAs: outcome.actingAs,
    }),
    signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) log.debug(`Activity report refused by the FTO app (${res.status})`);
    })
    .catch((err: unknown) => log.debug(`Activity report failed: ${err instanceof Error ? err.message : String(err)}`));

  if (error || access === "write") await send;
}
