/**
 * Every operation of the CLI must be valid against the Thinkific schema it is
 * sent to: queries against stable, mutations against beta. Catches renamed or
 * removed fields offline, without a token (refresh: `bun run schema`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildSchema, type GraphQLSchema, parse, validate } from "graphql";
import * as operations from "../src/lib/operations.ts";

const load = (name: string): GraphQLSchema =>
  buildSchema(readFileSync(new URL(`../schema/${name}.graphql`, import.meta.url), "utf8"), { assumeValidSDL: true });

const schemas = { stable: load("stable"), beta: load("beta") };

describe("Thinkific operations", () => {
  for (const [name, document] of Object.entries(operations)) {
    const isMutation = /^\s*mutation\b/.test(document);
    const api = isMutation ? "beta" : "stable";
    test(`${name} is valid on ${api}`, () => {
      const errors = validate(schemas[api], parse(document)).map((e) => e.message);
      expect(errors).toEqual([]);
    });
  }

  test("every operation is named (Thinkific rejects anonymous ones)", () => {
    for (const document of Object.values(operations)) {
      expect(document).toMatch(/^\s*(query|mutation) Cli\w+/);
    }
  });
});
