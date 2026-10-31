import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import openapiTS, { astToString } from "openapi-typescript";
import { format } from "oxfmt";

const { values } = parseArgs({ options: { source: { type: "string" } } });
if (values.source === undefined) {
  throw new Error("Provide --source <Stedi OpenAPI JSON file>.");
}
const source = await readFile(path.resolve(values.source), "utf-8");
const spec: unknown = JSON.parse(source);
const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
if (
  !isObject(spec) ||
  !isObject(spec.info) ||
  typeof spec.info.version !== "string" ||
  !isObject(spec.components) ||
  !isObject(spec.components.schemas)
) {
  throw new Error(
    "The Stedi OpenAPI source is missing its version or component schemas."
  );
}
const { version } = spec.info;
const sourceSchemas = spec.components.schemas;
const schemas: Record<string, unknown> = {};

const include = (name: string): void => {
  if (name in schemas) {
    return;
  }
  const schema = sourceSchemas[name];
  if (schema === undefined) {
    throw new Error(`Missing Stedi schema: ${name}`);
  }
  schemas[name] = schema;
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "$ref" && typeof child === "string") {
        include(child.replace("#/components/schemas/", ""));
      } else {
        visit(child);
      }
    }
  };
  visit(schema);
};
include("EligibilityCheckRequestContent");

const functionalSchema: unknown = JSON.parse(
  JSON.stringify(schemas, (key: string, value: unknown): unknown =>
    ["description", "example", "examples", "x-meta"].includes(key)
      ? undefined
      : value
  )
);
const output = new URL("../src/generated/", import.meta.url);
await mkdir(output, { recursive: true });
const ast = await openapiTS(
  JSON.stringify({
    components: { schemas: functionalSchema },
    info: {
      title: "Stedi eligibility field signatures",
      version,
    },
    openapi: "3.0.3",
    paths: {},
  })
);
const formatted = await format("stedi.ts", astToString(ast));
if (formatted.errors.length > 0) {
  throw new Error("Could not format the generated Stedi types.");
}
await writeFile(new URL("stedi.ts", output), formatted.code);
await writeFile(
  new URL("stedi.schema.json", output),
  `${JSON.stringify(
    {
      $ref: "#/components/schemas/EligibilityCheckRequestContent",
      components: { schemas: functionalSchema },
    },
    null,
    2
  )}\n`
);
await writeFile(
  new URL("source.json", output),
  `${JSON.stringify(
    {
      operation: "EligibilityCheck",
      sha256: createHash("sha256").update(source).digest("hex"),
      source: path.basename(values.source),
      version,
    },
    null,
    2
  )}\n`
);

console.log(
  `Generated ${Object.keys(schemas).length} Stedi request schemas and TypeScript types.`
);
