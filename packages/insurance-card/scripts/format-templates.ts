import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { format } from "oxfmt";

const { values } = parseArgs({ options: { check: { type: "boolean" } } });
const directory = new URL("../templates/issuer/", import.meta.url);
for await (const filename of new Bun.Glob("*.ts.template").scan(
  fileURLToPath(directory)
)) {
  const file = new URL(filename, directory);
  const source = await readFile(file, "utf-8");
  const result = await format(filename.replace(/\.template$/u, ""), source);
  if (result.errors.length > 0) {
    throw new Error(`Cannot format ${filename}.`);
  }
  if (source === result.code) {
    continue;
  }
  if (values.check === true) {
    throw new Error(`Run templates:format to format ${filename}.`);
  }
  await writeFile(file, result.code);
}
