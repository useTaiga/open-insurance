import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

import {
  createApplePassJson,
  InsuranceCardIssuer,
  parseWalletIssuer,
} from "../src/index";
import { renderCardPreview } from "./preview-card";

const { values } = parseArgs({
  options: {
    insurance: { type: "string" },
    issuer: { type: "string" },
    logo: { type: "string" },
    out: { type: "string" },
  },
});
if (
  values.insurance === undefined ||
  values.issuer === undefined ||
  values.out === undefined
) {
  throw new Error(
    "Use --insurance <JSON> --issuer <JSON> --out <new directory>."
  );
}
const data: unknown = JSON.parse(await readFile(values.insurance, "utf-8"));
const configuration: unknown = JSON.parse(
  await readFile(values.issuer, "utf-8")
);
const issuer = parseWalletIssuer(configuration);
const card = new InsuranceCardIssuer().issue(
  data,
  new Date(Date.now() + 86_400_000)
);
const logo =
  values.logo === undefined ? undefined : await readFile(values.logo);
const svg = renderCardPreview(card, issuer, logo);
const pass = createApplePassJson(card, issuer);
await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
await mkdir(values.out, { mode: 0o700 });
for (const [filename, content] of [
  ["card.svg", svg],
  ["card.png", new Resvg(svg).render().asPng()],
  ["pass.json", `${JSON.stringify(pass, null, 2)}\n`],
] as const) {
  await writeFile(path.join(values.out, filename), content, {
    flag: "wx",
    mode: 0o600,
  });
}
process.stdout.write(
  `Private visual preview written to ${values.out}. No pass signed, delivered, or enabled for NFC.\n`
);
