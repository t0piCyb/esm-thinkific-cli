/**
 * Thinkific sites: one API access token per profile.
 *
 * Thinkific's GraphQL API only accepts an API access token (Bearer) or an
 * OAuth token, not the older API key + subdomain pair, so the CLI stores the
 * token and the site it belongs to (read once by `auth login`).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { APP_CLI, FALLBACK_PROFILE, globalFlags, STATE_FILE, TOKEN_DIR } from "./config.js";
import { CliError } from "./errors.js";

export type Account = {
  token: string;
  site?: string;
  subdomain?: string;
  url?: string;
  /** Expiry chosen when the token was created in Thinkific, if given at login. */
  expiresAt?: string;
};

type State = { active?: string };

const FILE_PREFIX = `${APP_CLI}-`;
const FILE_SUFFIX = ".json";

/** Profile names become filenames, so restrict them to safe characters. */
export const sanitizeProfile = (profile: string) =>
  profile.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || FALLBACK_PROFILE;

const accountPath = (profile: string) =>
  join(TOKEN_DIR, `${FILE_PREFIX}${sanitizeProfile(profile)}${FILE_SUFFIX}`);

const readState = (): State => {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as State;
  } catch {
    return {};
  }
};

const writePrivate = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
};

export const defaultProfile = (): string =>
  process.env.THINKIFIC_PROFILE?.trim() || readState().active?.trim() || FALLBACK_PROFILE;

export const resolveProfile = (explicit?: string): string =>
  sanitizeProfile(explicit?.trim() || globalFlags.profile.trim() || defaultProfile());

export const setActiveProfile = (profile: string): void =>
  writePrivate(STATE_FILE, `${JSON.stringify({ ...readState(), active: sanitizeProfile(profile) }, null, 2)}\n`);

/** Agents, CI and the MCP gateway pass the token through the environment. */
const accountFromEnv = (): Account | null => {
  const token = process.env.THINKIFIC_API_TOKEN?.trim();
  return token ? { token } : null;
};

export const usesEnvAccount = (): boolean => Boolean(accountFromEnv());

export function hasAccount(profile?: string): boolean {
  return usesEnvAccount() || existsSync(accountPath(resolveProfile(profile)));
}

export function readAccount(profile?: string): Account {
  const fromEnv = accountFromEnv();
  if (fromEnv) return fromEnv;
  const name = resolveProfile(profile);
  if (!existsSync(accountPath(name))) {
    throw new CliError(
      2,
      `No Thinkific token for profile "${name}".`,
      `Run: ${APP_CLI} auth login --profile ${name}`,
    );
  }
  return JSON.parse(readFileSync(accountPath(name), "utf-8")) as Account;
}

export function saveAccount(account: Account, profile?: string): void {
  writePrivate(accountPath(resolveProfile(profile)), `${JSON.stringify(account, null, 2)}\n`);
}

export function removeAccount(profile?: string): void {
  const path = accountPath(resolveProfile(profile));
  if (existsSync(path)) unlinkSync(path);
}

export type StoredProfile = { name: string; active: boolean; site: string; subdomain: string; expiresAt: string };

export const listProfiles = (): StoredProfile[] => {
  if (!existsSync(TOKEN_DIR)) return [];
  const active = defaultProfile();
  return readdirSync(TOKEN_DIR)
    .filter((file) => file.startsWith(FILE_PREFIX) && file.endsWith(FILE_SUFFIX))
    .map((file) => file.slice(FILE_PREFIX.length, file.length - FILE_SUFFIX.length))
    .sort()
    .map((name) => {
      const account = JSON.parse(readFileSync(accountPath(name), "utf-8")) as Account;
      return {
        name,
        active: name === active,
        site: account.site ?? "-",
        subdomain: account.subdomain ?? "-",
        expiresAt: account.expiresAt ?? "-",
      };
    });
};
