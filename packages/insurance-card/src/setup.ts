import "reflect-metadata";
import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { X509Certificate as ParsedCertificate } from "@peculiar/x509";
import { z } from "zod";

import { parseWalletIssuer } from "./wallet";
import type { SigningCertificates, WalletIssuer } from "./wallet";

const setupSchema = z.strictObject({
  logo: z.string().optional(),
  name: z.string().min(1),
  payerId: z.string().min(1),
  readerPrivateKey: z.string().optional(),
  signing: z
    .strictObject({
      certificate: z.string(),
      passphraseEnvironment: z.string().optional(),
      privateKey: z.string(),
      wwdr: z.string(),
    })
    .optional(),
  wallet: z.unknown(),
});

export type IssuerSetup = Omit<z.infer<typeof setupSchema>, "wallet"> & {
  wallet: WalletIssuer;
};
export interface SetupCheck {
  id: string;
  status: "ready" | "blocked" | "unverified";
  detail: string;
}
export interface SetupReport {
  walletReady: boolean;
  nfcConfigured: boolean;
  nfcReady: boolean;
  checks: SetupCheck[];
}

export const readIssuerSetup = async (
  filename: string
): Promise<IssuerSetup> => {
  const config = setupSchema.parse(
    JSON.parse(await readFile(filename, "utf-8"))
  );
  return { ...config, wallet: parseWalletIssuer(config.wallet) };
};

export const loadSigningCertificates = async (
  config: IssuerSetup,
  directory: string
): Promise<SigningCertificates | undefined> => {
  if (!config.signing) {
    return undefined;
  }
  const { signing } = config;
  const passphrase =
    signing.passphraseEnvironment === undefined
      ? undefined
      : process.env[signing.passphraseEnvironment];
  if (signing.passphraseEnvironment !== undefined && passphrase === undefined) {
    throw new Error(
      `Set ${signing.passphraseEnvironment} for the signing key.`
    );
  }
  const [signerCert, signerKey, wwdr] = await Promise.all([
    readFile(path.resolve(directory, signing.certificate)),
    readFile(path.resolve(directory, signing.privateKey)),
    readFile(path.resolve(directory, signing.wwdr)),
  ]);
  return { signerCert, signerKey, signerKeyPassphrase: passphrase, wwdr };
};

const validNow = (certificate: X509Certificate) =>
  Date.parse(certificate.validFrom) <= Date.now() &&
  Date.parse(certificate.validTo) > Date.now();

export const inspectIssuerSetup = async (
  config: IssuerSetup,
  directory: string
): Promise<SetupReport> => {
  const checks: SetupCheck[] = [];
  const check = (id: string, ready: boolean, detail: string) => {
    checks.push({ detail, id, status: ready ? "ready" : "blocked" });
  };
  let signing: SigningCertificates | undefined;
  try {
    signing = await loadSigningCertificates(config, directory);
    check(
      "signing-files",
      signing !== undefined,
      signing
        ? "Signing files loaded."
        : "Configure signing.certificate, privateKey and wwdr with your Apple-issued files."
    );
  } catch {
    check(
      "signing-files",
      false,
      "Cannot load signing files or key passphrase. Check configured paths and environment."
    );
  }
  let enhanced = false;
  if (signing) {
    try {
      const certificate = new X509Certificate(signing.signerCert);
      const intermediate = new X509Certificate(signing.wwdr);
      const parsed = new ParsedCertificate(certificate.raw);
      const subject = parsed.subjectName;
      check(
        "identity",
        subject
          .getField("0.9.2342.19200300.100.1.1")
          .includes(config.wallet.passTypeIdentifier) &&
          subject.getField("2.5.4.11").includes(config.wallet.teamIdentifier),
        "Certificate UID and team OU must match wallet.passTypeIdentifier and wallet.teamIdentifier."
      );
      check(
        "validity",
        validNow(certificate) && validNow(intermediate),
        `Signer and WWDR must be current. Signer expires ${new Date(certificate.validTo).toISOString()}.`
      );
      const roots = await Promise.all(
        ["AppleIncRootCertificate", "AppleRootCA-G2", "AppleRootCA-G3"].map(
          async (name) =>
            new X509Certificate(
              await readFile(
                new URL(`../assets/apple/${name}.cer`, import.meta.url)
              )
            )
        )
      );
      check(
        "apple-chain",
        !certificate.ca &&
          intermediate.ca &&
          certificate.checkIssued(intermediate) &&
          certificate.verify(intermediate.publicKey) &&
          roots.some(
            (root) =>
              validNow(root) &&
              intermediate.checkIssued(root) &&
              intermediate.verify(root.publicKey)
          ),
        "Signer must chain through the configured WWDR to a bundled Apple root. Revocation is not checked offline."
      );
      const privateKey = createPrivateKey({
        key: signing.signerKey,
        passphrase: signing.signerKeyPassphrase,
      });
      check(
        "signing-key",
        certificate.publicKey
          .export({ format: "der", type: "spki" })
          .equals(
            createPublicKey(privateKey).export({ format: "der", type: "spki" })
          ),
        "Signing private key must match the certificate."
      );
      enhanced = parsed.extensions.some(
        (extension) => extension.type === "1.2.840.113635.100.6.1.26"
      );
      check(
        "pass-certificate",
        enhanced ||
          parsed.extensions.some(
            (extension) => extension.type === "1.2.840.113635.100.6.1.16"
          ),
        "Certificate must have Apple's Pass Type ID or enhanced NFC pass extension."
      );
    } catch {
      check(
        "certificate",
        false,
        "Cannot inspect certificates or signing key. Supply valid PEM files and the correct passphrase."
      );
    }
  }
  const walletReady = checks.every((item) => item.status === "ready");
  check(
    "nfc-certificate",
    enhanced,
    enhanced
      ? "Enhanced NFC extension found; Apple chain and identity checks must also pass."
      : "Request Apple's NFC pass permission and obtain the enhanced Pass Type ID certificate. An ordinary pass certificate cannot enable NFC."
  );
  const nfcConfigured = config.wallet.encryptionPublicKey !== undefined;
  let readerMatches = false;
  try {
    if (
      config.readerPrivateKey !== undefined &&
      config.wallet.encryptionPublicKey !== undefined
    ) {
      const privateKey = createPrivateKey(
        await readFile(path.resolve(directory, config.readerPrivateKey))
      );
      const publicKey = createPublicKey(privateKey);
      readerMatches =
        privateKey.asymmetricKeyType === "ec" &&
        privateKey.asymmetricKeyDetails?.namedCurve === "prime256v1" &&
        publicKey.export({ format: "der", type: "spki" }).toString("base64") ===
          config.wallet.encryptionPublicKey;
    }
  } catch {
    readerMatches = false;
  }
  check(
    "reader-key",
    readerMatches,
    readerMatches
      ? "Reader encryption key pair matches (P-256). Keep the private key on the resolver."
      : "Configure matching P-256 wallet.encryptionPublicKey and readerPrivateKey. Keep the private key on the resolver."
  );
  checks.push({
    detail:
      "Install the signed NFC pass and verify an encrypted read on your actual reader. This checker does not certify hardware or production readiness.",
    id: "physical-tap",
    status: "unverified",
  });
  return {
    checks,
    nfcConfigured,
    nfcReady: walletReady && enhanced && readerMatches,
    walletReady,
  };
};
