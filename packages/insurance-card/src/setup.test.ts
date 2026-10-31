import "reflect-metadata";
import { expect, test } from "bun:test";
import { createPrivateKey } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BasicConstraintsExtension,
  Extension,
  X509CertificateGenerator,
} from "@peculiar/x509";

import { inspectIssuerSetup } from "./setup";
import { generateNfcKeys } from "./wallet";

test("setup distinguishes ordinary certificates, spoofed NFC capability, expired identity and mismatched reader keys", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "insurance-setup-"));
  try {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );
    const signingKey = createPrivateKey({
      format: "der",
      key: Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)),
      type: "pkcs8",
    });
    await writeFile(
      path.join(directory, "key.pem"),
      signingKey.export({ format: "pem", type: "pkcs8" })
    );
    const reader = generateNfcKeys();
    await writeFile(path.join(directory, "reader.pem"), reader.privateKey);
    for (const enhanced of [false, true]) {
      const certificate = await X509CertificateGenerator.createSelfSigned({
        extensions: [
          new Extension(
            `1.2.840.113635.100.6.1.${enhanced ? "26" : "16"}`,
            false,
            new Uint8Array([5, 0])
          ),
        ],
        keys,
        name: "0.9.2342.19200300.100.1.1=pass.example.insurance, OU=EXAMPLE123, CN=Untrusted Test",
        notAfter: new Date(Date.now() + 86_400_000),
        notBefore: new Date(Date.now() - 60_000),
      });
      const intermediate = await X509CertificateGenerator.createSelfSigned({
        extensions: [new BasicConstraintsExtension(true)],
        keys,
        name: "CN=Untrusted Test CA",
      });
      await writeFile(
        path.join(directory, "cert.pem"),
        certificate.toString("pem")
      );
      await writeFile(
        path.join(directory, "wwdr.pem"),
        intermediate.toString("pem")
      );
      const config = {
        name: "Example",
        payerId: "00001",
        readerPrivateKey: "reader.pem",
        signing: {
          certificate: "cert.pem",
          privateKey: "key.pem",
          wwdr: "wwdr.pem",
        },
        wallet: {
          encryptionPublicKey: reader.encryptionPublicKey,
          organizationName: "Example",
          passTypeIdentifier: "pass.example.insurance",
          teamIdentifier: "EXAMPLE123",
        },
      };
      const report = await inspectIssuerSetup(config, directory);
      expect(report.walletReady).toBe(false);
      expect(report.nfcReady).toBe(false);
      expect(
        report.checks.find((check) => check.id === "identity")?.status
      ).toBe("ready");
      expect(
        report.checks.find((check) => check.id === "signing-key")?.status
      ).toBe("ready");
      expect(
        report.checks.find((check) => check.id === "apple-chain")?.status
      ).toBe("blocked");
      expect(
        report.checks.find((check) => check.id === "nfc-certificate")?.status
      ).toBe(enhanced ? "ready" : "blocked");
      expect(
        report.checks.find((check) => check.id === "reader-key")?.status
      ).toBe("ready");
      config.wallet.teamIdentifier = "OTHER12345";
      config.wallet.encryptionPublicKey = generateNfcKeys().encryptionPublicKey;
      const mismatched = await inspectIssuerSetup(config, directory);
      expect(
        mismatched.checks.find((check) => check.id === "identity")?.status
      ).toBe("blocked");
      expect(
        mismatched.checks.find((check) => check.id === "reader-key")?.status
      ).toBe("blocked");
    }
    const expired = await X509CertificateGenerator.createSelfSigned({
      keys,
      name: "CN=Expired",
      notAfter: new Date("2021-01-01"),
      notBefore: new Date("2020-01-01"),
    });
    await writeFile(path.join(directory, "cert.pem"), expired.toString("pem"));
    const report = await inspectIssuerSetup(
      {
        name: "Example",
        payerId: "00001",
        signing: {
          certificate: "cert.pem",
          privateKey: "key.pem",
          wwdr: "wwdr.pem",
        },
        wallet: {
          organizationName: "Example",
          passTypeIdentifier: "pass.example.insurance",
          teamIdentifier: "EXAMPLE123",
        },
      },
      directory
    );
    expect(report.checks.find((check) => check.id === "validity")?.status).toBe(
      "blocked"
    );
    expect(report.nfcReady).toBe(false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
