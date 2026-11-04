import { type GraphqlApi, GRAPHQL_URLS, REST_URL } from "./config.js";
import { CliError } from "./errors.js";
import { log } from "./logger.js";
import { readAccount } from "./session.js";

const TIMEOUT_MS = 60_000;
/** Longest wait for Thinkific's per-minute cost budget to come back. */
const MAX_RATE_LIMIT_WAIT_MS = 65_000;

type GraphQLError = { message: string; path?: string[]; extensions?: { code?: string } };
type RateLimit = { cost: number; remaining: number; resetAt: string; limit: number };
type GraphQLResponse<T> = { data?: T; errors?: GraphQLError[]; extensions?: { rateLimit?: RateLimit } };

export type UserError = { code: string; message: string; path?: string[] | null };

const PLAN_HINT =
  "Check the API access token (Settings > Code & analytics > API access tokens, it may have expired) and that the site's plan includes the API (Grow or above).";

const isMutation = (document: string) => /^\s*(#[^\n]*\n\s*)*mutation\b/.test(document);

async function post<T>(url: string, token: string, query: string, variables: Record<string, unknown>) {
  log.debug(`POST ${url} ${query.match(/^\s*(query|mutation)\s+(\w+)/)?.[2] ?? ""}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CliError(1, `Cannot reach Thinkific: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new CliError(401, `Thinkific refused the token (${res.status})`, PLAN_HINT);
  }
  const body = (await res.json().catch(() => null)) as GraphQLResponse<T> | null;
  if (!body) throw new CliError(res.status >= 400 ? res.status : 500, `${res.status}: invalid response from Thinkific`);
  return body;
}

/**
 * Runs a GraphQL operation with the profile's token. Queries go to the stable
 * API and mutations to beta (the only one with course content mutations),
 * unless `api` says otherwise. Waits once for the rate limit window when
 * Thinkific answers RATE_LIMITED.
 */
export async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
  opts: { api?: GraphqlApi } = {},
): Promise<T> {
  const { token } = readAccount();
  const url = GRAPHQL_URLS[opts.api ?? (isMutation(query) ? "beta" : "stable")];

  let res = await post<T>(url, token, query, variables);
  if (res.errors?.some((e) => e.extensions?.code === "RATE_LIMITED")) {
    const resetAt = Date.parse(res.extensions?.rateLimit?.resetAt ?? "");
    const wait = Number.isNaN(resetAt) ? 60_000 : Math.min(Math.max(resetAt - Date.now(), 1_000), MAX_RATE_LIMIT_WAIT_MS);
    log.warn(`Thinkific rate limit reached, waiting ${Math.ceil(wait / 1000)}s`);
    await Bun.sleep(wait);
    res = await post<T>(url, token, query, variables);
  }
  const rate = res.extensions?.rateLimit;
  if (rate) log.debug(`cost ${rate.cost}, ${rate.remaining}/${rate.limit} left until ${rate.resetAt}`);

  if (res.errors?.length) {
    const message = res.errors.map((e) => e.message).join("; ");
    const codes = res.errors.map((e) => e.extensions?.code ?? "");
    const code = codes.includes("UNAUTHENTICATED")
      ? 401
      : codes.includes("FORBIDDEN") || /permission|forbidden|not allowed|scope/i.test(message)
        ? 403
        : codes.includes("NOT_FOUND") || /not found|couldn't find/i.test(message)
          ? 404
          : codes.includes("RATE_LIMITED")
            ? 429
            : 1;
    throw new CliError(code, `Thinkific: ${message}`, code === 401 ? PLAN_HINT : undefined);
  }
  if (!res.data) throw new CliError(1, "Thinkific returned no data");
  return res.data;
}

/**
 * Runs a mutation and returns its payload (`data[field]`), turning the
 * payload's `userErrors` into a CLI error.
 */
export async function mutate<P = Record<string, unknown>>(
  mutation: string,
  field: string,
  input: Record<string, unknown>,
): Promise<P> {
  const data = await gql<Record<string, (P & { userErrors?: UserError[] | null }) | null>>(mutation, { input });
  const payload = data[field];
  if (!payload) throw new CliError(1, `Thinkific returned no ${field} result`);
  if (payload.userErrors?.length) {
    const message = payload.userErrors
      .map((e) => `${e.message}${e.path?.length ? ` (${e.path.join(".")})` : ""}`)
      .join("; ");
    const code = payload.userErrors.some((e) => /not.?found/i.test(e.code)) ? 404 : 422;
    throw new CliError(code, `Thinkific: ${message}`);
  }
  return payload;
}

/** Walks a Relay connection page by page (Thinkific caps `first` at 100). */
export async function paginate<N>(
  fetchPage: (after: string | null) => Promise<{ nodes?: (N | null)[] | null; pageInfo: { hasNextPage: boolean; endCursor?: string | null } }>,
  limit = Number.POSITIVE_INFINITY,
): Promise<N[]> {
  const items: N[] = [];
  let after: string | null = null;
  while (items.length < limit) {
    const page = await fetchPage(after);
    items.push(...(page.nodes ?? []).filter((n): n is N => n !== null));
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
  }
  return items.slice(0, limit);
}

/** REST Admin API v1 with the same token (users, enrollments, orders...). */
export async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { token } = readAccount();
  const url = `${REST_URL}/${path.replace(/^\/+/, "")}`;
  log.debug(`${method} ${url}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new CliError(1, `Cannot reach Thinkific: ${err instanceof Error ? err.message : String(err)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new CliError(res.status, `${res.status}: ${text.slice(0, 500) || res.statusText}`, res.status === 401 ? PLAN_HINT : undefined);
  }
  return (text ? JSON.parse(text) : null) as T;
}
