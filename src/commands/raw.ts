import { Command } from "commander";
import { gql, rest } from "../lib/client.js";
import { globalFlags } from "../lib/config.js";
import { CliError, handleError } from "../lib/errors.js";
import { readInput } from "../lib/io.js";
import { output } from "../lib/output.js";

/**
 * Any Thinkific GraphQL operation with the stored token, for what the commands
 * do not cover. Schema: https://studio.apollographql.com/public/thinkific-unified-graph
 * (or schema/*.graphql in this repository).
 */
export const gqlCommand = new Command("gql")
  .description("Run any Thinkific GraphQL query or mutation (queries: stable API, mutations: beta)")
  .argument("<query>", "Named GraphQL operation, or @file.graphql, or - for stdin")
  .option("--vars <json>", "Variables as JSON", "{}")
  .option("--beta", "Send to the beta API (default for mutations)")
  .option("--stable", "Send to the stable API (default for queries)")
  .addHelpText(
    "after",
    "\nThinkific rejects anonymous operations and connections without `first` (max 100).\nExamples:\n  esm-thinkific-cli gql 'query Me { site { name url } }'\n  esm-thinkific-cli gql 'query L($id: ID!) { lesson(id: $id) { title } }' --vars '{\"id\":\"123\"}'",
  )
  .action(async (query: string, opts: { vars: string; beta?: boolean; stable?: boolean }) => {
    try {
      if (opts.beta && opts.stable) throw new CliError(2, "Pass --beta or --stable, not both");
      const document = query === "-" || query.startsWith("@") ? await readInput(query === "-" ? "-" : query.slice(1)) : query;
      const api = opts.beta ? "beta" : opts.stable ? "stable" : undefined;
      output(await gql(document, JSON.parse(opts.vars) as Record<string, unknown>, { api }));
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });

/** The REST Admin API v1 (users, enrollments, orders, groups...) with the same token. */
export const restCommand = new Command("rest")
  .description("Call the Thinkific REST Admin API v1 (users, enrollments, orders, groups...)")
  .argument("<method>", "GET, POST, PUT or DELETE")
  .argument("<path>", "Path under /api/public/v1, e.g. users?query[email]=a@b.org")
  .option("--data <json>", "Request body as JSON, or @file.json")
  .addHelpText(
    "after",
    "\nReference: https://developers.thinkific.com/api/api-documentation/\nExamples:\n  esm-thinkific-cli rest GET 'enrollments?query[course_id]=123&limit=25'\n  esm-thinkific-cli rest GET users/42",
  )
  .action(async (method: string, path: string, opts: { data?: string }) => {
    try {
      const verb = method.toUpperCase();
      if (!["GET", "POST", "PUT", "DELETE"].includes(verb)) throw new CliError(2, `Unsupported method ${method}`);
      const raw = opts.data?.startsWith("@") ? await readInput(opts.data.slice(1)) : opts.data;
      output(await rest(verb, path, raw === undefined ? undefined : JSON.parse(raw)));
    } catch (err) {
      handleError(err, globalFlags.json);
    }
  });
