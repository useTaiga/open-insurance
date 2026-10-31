import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

import {
  createApplePassJson,
  InsuranceCardIssuer,
  parseWalletIssuer,
} from "../src/index";

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
const pass = createApplePassJson(card, issuer);
const patient = card.insurance.dependents?.[0] ?? card.insurance.subscriber;
const name = [patient.firstName, patient.lastName].filter(Boolean).join(" ");
const policyholder = [
  card.insurance.subscriber.firstName,
  card.insurance.subscriber.lastName,
]
  .filter(Boolean)
  .join(" ");
const esc = (value: string) => Bun.escapeHTML(value);
const brand = esc(issuer.organizationName);
const brandSize = issuer.organizationName.length > 24 ? 30 : 44;
const logo =
  values.logo === undefined ? undefined : await readFile(values.logo);
const headingX = logo === undefined ? 54 : 208;
const memberId = esc(card.insurance.subscriber.memberId ?? "Not provided");
const group = esc(card.insurance.subscriber.groupNumber ?? "Not provided");
const plan = esc(card.insurance.tradingPartnerName ?? "Plan not provided");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="680" viewBox="0 0 1000 680">
<rect width="1000" height="680" rx="48" fill="${pass.backgroundColor}"/>
<g font-family="Arial, sans-serif" fill="${pass.foregroundColor}">
${logo === undefined ? "" : `<rect x="54" y="36" width="128" height="128" rx="20" fill="white"/><image x="68" y="50" width="100" height="100" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logo.toString("base64")}"/>`}
<text x="${headingX}" y="88" font-size="${brandSize}" font-weight="700">${brand}</text>
<text x="${headingX}" y="124" font-size="15" letter-spacing="2" fill="${pass.labelColor}">INSURANCE MEMBERSHIP</text>
<path d="M900 67q25 20 0 40m14-49q36 29 0 58m14-68q47 39 0 78" fill="none" stroke="${pass.foregroundColor}" stroke-width="5" stroke-linecap="round"/>
<text x="54" y="220" font-size="16" letter-spacing="2" fill="${pass.labelColor}">MEMBER</text>
<text x="54" y="276" font-size="46" font-weight="600">${esc(name)}</text>
<text x="54" y="351" font-size="16" letter-spacing="2" fill="${pass.labelColor}">MEMBER ID</text>
<text x="54" y="393" font-size="29">${memberId}</text>
<text x="620" y="351" font-size="16" letter-spacing="2" fill="${pass.labelColor}">GROUP</text>
<text x="620" y="393" font-size="29">${group}</text>
<text x="54" y="464" font-size="16" letter-spacing="2" fill="${pass.labelColor}">PLAN</text>
<text x="54" y="503" font-size="25">${plan}</text>
<text x="54" y="562" font-size="17" fill="${pass.labelColor}">Subscriber: ${esc(policyholder)}</text>
<path d="M54 603H946" stroke="${pass.labelColor}" opacity="0.35"/>
<text x="54" y="642" font-size="15" letter-spacing="1" fill="${pass.labelColor}">DESIGN PREVIEW · NOT AN ISSUED CARD · NFC NOT ENABLED</text>
</g></svg>`;
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
