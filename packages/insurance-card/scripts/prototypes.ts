import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

import {
  createPartnerPrototype,
  partnerPrototypes,
} from "../examples/partners";
import { createEligibilityRequest, parseWalletIssuer } from "../src/index";
import { clinicSample } from "../src/samples";
import { renderCardPreview } from "./preview-card";

const { values } = parseArgs({
  options: {
    issuer: { type: "string" },
    out: { type: "string" },
    "signer-cert": { type: "string" },
    "signer-key": { type: "string" },
    wwdr: { type: "string" },
  },
});
if (values.out === undefined) {
  throw new Error(
    "Use --out <new directory> for fictional partner prototypes."
  );
}
const signingPaths = [
  values.issuer,
  values["signer-cert"],
  values["signer-key"],
  values.wwdr,
];
if (signingPaths.some(Boolean) && !signingPaths.every(Boolean)) {
  throw new Error(
    "Signing requires --issuer, --signer-cert, --signer-key and --wwdr together."
  );
}
const signing =
  values.issuer !== undefined &&
  values["signer-cert"] !== undefined &&
  values["signer-key"] !== undefined &&
  values.wwdr !== undefined
    ? {
        certificates: {
          signerCert: await readFile(values["signer-cert"]),
          signerKey: await readFile(values["signer-key"]),
          signerKeyPassphrase: process.env.INSURANCE_CARD_SIGNER_KEY_PASSPHRASE,
          wwdr: await readFile(values.wwdr),
        },
        issuer: parseWalletIssuer(
          JSON.parse(await readFile(values.issuer, "utf-8"))
        ),
      }
    : undefined;
const output = path.resolve(values.out);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output, { mode: 0o700 });
const save = async (name: string, data: string | Buffer) => {
  const filename = path.join(output, name);
  await mkdir(path.dirname(filename), { mode: 0o700, recursive: true });
  await writeFile(filename, data, { flag: "wx", mode: 0o600 });
};
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const manifest = [];
const previews: Buffer[] = [];
for (const partner of partnerPrototypes) {
  for (const dependent of [false, true]) {
    const directory = `${partner.slug}${dependent ? "/dependent" : ""}`;
    const prototype = await createPartnerPrototype(
      partner,
      signing?.issuer ?? {
        passTypeIdentifier: `pass.org.openinsurance.demo.${partner.slug}`,
        teamIdentifier: "EXAMPLE001",
      },
      dependent
    );
    const { card, issuer, logo, wallet } = prototype;
    const svg = renderCardPreview(card, wallet, logo);
    const png = new Resvg(svg).render().asPng();
    if (!dependent) {
      previews.push(png);
    }
    const supplied = issuer.benefits(
      card.message,
      clinicSample.billingProviderNpi
    );
    const request = createEligibilityRequest(card.insurance, clinicSample);
    await save(`${directory}/card.svg`, svg);
    await save(`${directory}/card.png`, png);
    await save(`${directory}/card.json`, json(card));
    await save(`${directory}/insurance.json`, json(card.insurance));
    await save(`${directory}/issuer.json`, json(wallet));
    await save(`${directory}/pass.json`, json(issuer.pass(card.message)));
    await save(`${directory}/benefits.json`, json(supplied));
    await save(`${directory}/stedi-request.json`, json(request));
    await save(
      `${directory}/reader-result.json`,
      json({
        benefits: supplied,
        demo: true,
        insurance: issuer.resolve(card.message).insurance,
        mode: "simulated-read",
        sent: false,
      })
    );
    if (signing !== undefined) {
      await save(
        `${directory}/insurance.pkpass`,
        await issuer.sign(card.message, signing.certificates)
      );
    }
    manifest.push({
      dependent,
      directory,
      name: partner.name,
      payerId: partner.payerId,
      stediId: partner.stediId,
      walletSigned: signing !== undefined,
    });
  }
}
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="2040" height="730" viewBox="0 0 2040 730">
<rect width="2040" height="730" fill="#f7f7f3"/>
<g font-family="Arial, sans-serif" fill="#163e34">
<text x="56" y="75" font-size="47" font-weight="700">Open Insurance</text>
<text x="1984" y="75" text-anchor="end" font-size="25">by Taiga</text>
<text x="56" y="118" font-size="23" fill="#58645f">Fictional member prototypes for issuer integration conversations.</text>
${partnerPrototypes
  .map(
    (
      partner,
      index
    ) => `<image x="${56 + index * 668}" y="168" width="600" height="396" href="data:image/png;base64,${previews[index].toString("base64")}"/>
<text x="${56 + index * 668}" y="615" font-size="26" font-weight="700">${partner.name}</text>
<text x="${56 + index * 668}" y="653" font-size="20" fill="#58645f">Payer ${partner.payerId} · Stedi ${partner.stediId}</text>`
  )
  .join("")}
<text x="56" y="707" font-size="18" fill="#58645f">Independent concepts. No insurer partnership implied. Benefits are fictional. NFC is disabled. Wallet layout may vary.</text>
</g></svg>`;
await save("contact-sheet.svg", sheet);
await save("contact-sheet.png", new Resvg(sheet).render().asPng());
await save(
  "manifest.json",
  json({
    cards: manifest,
    demo: true,
    eligibilitySent: false,
    nfcEnabled: false,
  })
);
await save(
  "README.txt",
  `Open Insurance - fictional issuer prototypes\n\nEach insurer has subscriber and dependent examples. All member details and benefits are fictional. No payer inquiry was sent.\n\ncard.png and contact-sheet.png are visual concepts; Apple Wallet layout may vary. pass.json is unsigned. ${signing ? "insurance.pkpass is a signed ordinary Wallet test pass, marked DEMO and issued by Open Insurance by Taiga." : "No installable pass was signed. Supply your own Apple signing configuration to produce insurance.pkpass."}\n\nNFC is disabled. No resolver is hosted for these exported references. reader-result.json records a simulated SDK resolution at generation time. It is not a physical tap or payer response.\n\nStedi payer metadata and logo sources are documented in the repository's partner-prototypes guide. Payer IDs must be confirmed against the member's plan before a live integration.\n\nhttps://github.com/useTaiga/open-insurance\n`
);
process.stdout.write(
  `Generated six fictional prototypes in ${output}. ${signing ? "Signed ordinary Wallet demo passes included." : "Unsigned previews only."} NFC disabled; no eligibility inquiries sent.\n`
);
