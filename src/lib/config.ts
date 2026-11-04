import { homedir } from "os";
import { join } from "path";

/** Application name */
export const APP_NAME = "esm-thinkific";

/** CLI binary name */
export const APP_CLI = "esm-thinkific-cli";

/**
 * Thinkific GraphQL API. Reads go to `stable`; course content mutations
 * (chapters, text lessons) only exist on `beta`, which Thinkific may change
 * without notice. `schema/*.graphql` is the copy the tests validate against.
 */
export const GRAPHQL_URLS = {
  stable: process.env.THINKIFIC_GRAPHQL_URL?.trim() || "https://api.thinkific.com/stable/graphql",
  beta: process.env.THINKIFIC_GRAPHQL_BETA_URL?.trim() || "https://api.thinkific.com/beta/graphql",
} as const;

export type GraphqlApi = keyof typeof GRAPHQL_URLS;

/** REST Admin API v1 (users, enrollments, orders...), same token. */
export const REST_URL = process.env.THINKIFIC_REST_URL?.trim() || "https://api.thinkific.com/api/public/v1";

/** Profile used when nothing else selects one (one profile per Thinkific site). */
export const FALLBACK_PROFILE = "default";

/**
 * One file per profile, `~/.config/tokens/esm-thinkific-cli-<profile>.json`
 * (chmod 600): the site's API access token (Settings > Code & analytics >
 * API access tokens) and the site it opens. THINKIFIC_API_TOKEN overrides the
 * profile for agents, CI and the MCP gateway.
 */
export const TOKEN_DIR = join(homedir(), ".config", "tokens");
export const STATE_FILE = join(homedir(), ".config", APP_CLI, "state.json");

/** Lesson HTML as it was before each `lessons update`, to undo a bad write. */
export const BACKUP_DIR = join(homedir(), ".cache", APP_CLI, "backups");

/** Global state for output flags (set by root command) */
export const globalFlags = {
  json: false,
  format: "text" as "text" | "json" | "csv" | "yaml",
  verbose: false,
  noColor: false,
  noHeader: false,
  /** Resolved once by the root preAction hook: flag > env > active > fallback. */
  profile: "",
};
