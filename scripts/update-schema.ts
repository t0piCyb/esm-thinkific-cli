/**
 * Refreshes schema/stable.graphql and schema/beta.graphql from Thinkific's
 * public Apollo graph (no token needed), then `bun test` tells which CLI
 * operation a schema change breaks.
 */
import { writeFileSync } from "node:fs";

const VARIANTS = { stable: "stable-production", beta: "beta-production" } as const;

for (const [file, variant] of Object.entries(VARIANTS)) {
  const res = await fetch("https://graphql.api.apollographql.com/api/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apollographql-client-name": "esm-thinkific-cli",
      "apollographql-client-version": "0.1.0",
    },
    body: JSON.stringify({
      query: `query Schema($ref: ID!) { variant(ref: $ref) { ... on GraphVariant { latestPublication { publishedAt schema { document } } } } }`,
      variables: { ref: `thinkific-unified-graph@${variant}` },
    }),
  });
  const body = (await res.json()) as {
    data?: { variant?: { latestPublication?: { publishedAt: string; schema: { document: string } } } };
  };
  const publication = body.data?.variant?.latestPublication;
  if (!publication) throw new Error(`No schema for ${variant}: ${JSON.stringify(body).slice(0, 300)}`);
  writeFileSync(new URL(`../schema/${file}.graphql`, import.meta.url), publication.schema.document);
  console.log(`schema/${file}.graphql <- ${variant}, published ${publication.publishedAt}`);
}
