import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Phase G1: prisma/schema.production.prisma is never hand-edited -- it's
// derived from prisma/schema.prisma (the single source of truth for every
// model) by swapping only the datasource block below. Hand-maintaining two
// near-identical schema files invites drift the moment a model changes in
// one and not the other; generating one from the other makes that
// impossible by construction.
//
// Run via `npm run db:generate-prod-schema`, and as a pre-step of both
// db:migrate:dev and db:migrate:deploy so the production schema can never
// go stale relative to a model change that hasn't been regenerated yet.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, "../prisma/schema.prisma");
const TARGET = path.join(__dirname, "../prisma/schema.production.prisma");

const DATASOURCE_BLOCK = /datasource db \{[^}]*\}/;
const PRODUCTION_DATASOURCE = `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}`;

const GENERATED_HEADER = `// GENERATED FILE -- do not hand-edit.
//
// Derived from schema.prisma by scripts/generateProductionSchema.ts
// (\`npm run db:generate-prod-schema\`), swapping only the datasource
// block for Postgres. Every model here is identical to schema.prisma by
// construction -- to change a model, edit schema.prisma and regenerate,
// never this file directly (a hand-edit here is silently overwritten on
// the next regenerate, and would drift from schema.prisma in the meantime).

`;

function main(): void {
  const source = readFileSync(SOURCE, "utf8");
  if (!DATASOURCE_BLOCK.test(source)) {
    throw new Error(`Could not find a "datasource db { ... }" block in ${SOURCE}`);
  }

  const production = GENERATED_HEADER + source.replace(DATASOURCE_BLOCK, PRODUCTION_DATASOURCE);
  writeFileSync(TARGET, production);
  console.log(`Wrote ${TARGET}`);
}

main();
