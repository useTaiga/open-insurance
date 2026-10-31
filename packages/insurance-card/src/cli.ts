#!/usr/bin/env bun
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { parseClinicContext } from "./contract";
import {
  createApplePassJson,
  createEligibilityRequest,
  decryptVasData,
  generateNfcKeys,
  InsuranceCardIssuer,
  signApplePass,
  parseVasReadInput,
} from "./index";
import { clinicSample, dependentSample, subscriberSample } from "./samples";
import { SqliteCardStore } from "./sqlite";
import { parseWalletIssuer } from "./wallet";

const {
  positionals: [command],
  values,
} = parseArgs({
  allowPositionals: true,
  options: {
    capture: { type: "string" },
    clinic: { type: "string" },
    "expires-at": { type: "string" },
    insurance: { type: "string" },
    issuer: { type: "string" },
    message: { type: "string" },
    "message-stdin": { type: "boolean" },
    "nfc-private-key": { type: "string" },
    out: { type: "string" },
    "signer-cert": { type: "string" },
    "signer-key": { type: "string" },
    store: { type: "string" },
    url: { default: "http://127.0.0.1:4320", type: "string" },
    wwdr: { type: "string" },
  },
});
const required = (value: string | undefined, flag: string): string => {
  if (value === undefined) {
    throw new Error(`Missing --${flag}`);
  }
  return value;
};
const jsonFile = async (filename: string): Promise<unknown> =>
  JSON.parse(await readFile(filename, "utf-8"));
const save = async (filename: string, data: string | Buffer): Promise<void> => {
  await writeFile(filename, data, { flag: "wx", mode: 0o600 });
};

try {
  if (command === "signing-request") {
    const directory = path.resolve(required(values.out, "out"));
    await mkdir(directory, { mode: 0o700 });
    const key = path.join(directory, "signer-key.pem");
    const csr = path.join(directory, "wallet.certSigningRequest");
    const signingProcess = Bun.spawn(
      [
        "openssl",
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        csr,
        "-subj",
        "/CN=Insurance Card Prototype",
      ],
      { stderr: "pipe", stdout: "ignore" }
    );
    const error = await new Response(signingProcess.stderr).text();
    if ((await signingProcess.exited) !== 0) {
      throw new Error(`Signing request generation failed: ${error}`);
    }
    await chmod(key, 0o600);
    await chmod(csr, 0o600);
    process.stdout.write(
      `Created ${csr}. Upload only the signing request to Apple. The private key remains in ${directory}.\n`
    );
  } else if (command === "keys" || command === "examples") {
    const directory = path.resolve(required(values.out, "out"));
    await mkdir(directory, { mode: 0o700, recursive: true });
    const keys = generateNfcKeys();
    await save(path.resolve(directory, "nfc-private-key.pem"), keys.privateKey);
    await save(
      path.resolve(directory, "nfc-public-key.txt"),
      keys.encryptionPublicKey
    );
    if (command === "examples") {
      const examples = {
        "clinic.json": clinicSample,
        "dependent.json": dependentSample,
        "issuer.json": {
          encryptionPublicKey: keys.encryptionPublicKey,
          organizationName: "Example Health",
          passTypeIdentifier: "pass.org.openinsurance.demo",
          teamIdentifier: "EXAMPLE001",
        },
        "subscriber.json": subscriberSample,
      };
      for (const [name, value] of Object.entries(examples)) {
        await save(
          path.resolve(directory, name),
          `${JSON.stringify(value, null, 2)}\n`
        );
      }
    }
    process.stdout.write(
      `Created P-256 NFC keys in ${directory}. Keep the private key on the issuer server.\n`
    );
  } else if (command === "prepare") {
    const data = await jsonFile(required(values.insurance, "insurance"));
    const clinic = parseClinicContext(
      await jsonFile(required(values.clinic, "clinic"))
    );
    const issuer = parseWalletIssuer(
      await jsonFile(required(values.issuer, "issuer"))
    );
    const directory = path.resolve(required(values.out, "out"));
    const expiresAt = new Date(required(values["expires-at"], "expires-at"));
    const card = new InsuranceCardIssuer().issue(data, expiresAt);
    const pass = createApplePassJson(card, issuer);
    const request = createEligibilityRequest(data, clinic);
    const signing = [values["signer-cert"], values["signer-key"], values.wwdr];
    if (signing.some(Boolean) && !signing.every(Boolean)) {
      throw new Error(
        "Signing needs --signer-cert, --signer-key, and --wwdr together."
      );
    }
    const signed = signing.every(Boolean)
      ? await signApplePass(card, issuer, {
          signerCert: await readFile(
            required(values["signer-cert"], "signer-cert")
          ),
          signerKey: await readFile(
            required(values["signer-key"], "signer-key")
          ),
          signerKeyPassphrase: process.env.INSURANCE_CARD_SIGNER_KEY_PASSPHRASE,
          wwdr: await readFile(required(values.wwdr, "wwdr")),
        })
      : undefined;
    await mkdir(directory, { mode: 0o700, recursive: true });
    for (const [name, content] of Object.entries({
      "card.json": card,
      "pass.json": pass,
      "stedi-request.json": request,
    })) {
      await save(
        path.resolve(directory, name),
        `${JSON.stringify(content, null, 2)}\n`
      );
    }
    if (signed) {
      await save(path.resolve(directory, "insurance.pkpass"), signed);
    }
    if (values.store !== undefined) {
      const store = new SqliteCardStore(path.resolve(values.store));
      try {
        store.set(card.message, card);
      } finally {
        store.close();
      }
    }
    process.stdout.write(
      `${signed ? "Signed pass" : "Unsigned pass preview"} prepared in ${directory}. No eligibility inquiry sent.\n`
    );
  } else if (command === "vas-decrypt") {
    const capture = await jsonFile(required(values.capture, "capture"));
    const envelope = parseVasReadInput(
      capture !== null && typeof capture === "object" && "envelope" in capture
        ? capture.envelope
        : capture
    );
    const decrypted = decryptVasData({
      passTypeIdentifier: envelope.passTypeIdentifier,
      privateKey: await readFile(
        required(values["nfc-private-key"], "nfc-private-key")
      ),
      vasData: Buffer.from(envelope.vasDataBase64, "base64"),
    });
    process.stdout.write(
      `${JSON.stringify({ ...decrypted, diagnosticOnly: true, eligibilitySent: false }, null, 2)}\n`
    );
  } else if (command === "resolve") {
    const stdin =
      values["message-stdin"] === true ? await Bun.stdin.text() : undefined;
    const message =
      stdin === undefined ? required(values.message, "message") : stdin.trim();
    const response = await fetch(new URL("/api/tap", values.url), {
      body: JSON.stringify({ message }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result: unknown = await response.json();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!response.ok) {
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(
      "insurance-card signing-request --out <new directory>\n"
    );
    process.stdout.write("insurance-card examples --out <directory>\n");
    process.stdout.write(
      "insurance-card vas-decrypt --capture <reader JSON> --nfc-private-key <PEM file>\n"
    );
    process.stdout.write(
      "insurance-card keys --out <directory>\ninsurance-card prepare --insurance <json> --clinic <json> --issuer <json> --expires-at <ISO date> --out <directory> [--store <sqlite file>] [--signer-cert <pem> --signer-key <pem> --wwdr <pem>]\ninsurance-card resolve --message <decrypted NFC token> [--url http://127.0.0.1:4320]\n"
    );
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Insurance card command failed."}\n`
  );
  process.exitCode = 1;
}
