import { readFile } from "node:fs/promises";

import { parseWalletIssuer } from "@open-insurance/core";
import type {
  CardStore,
  SigningCertificates,
  WalletIssuer,
} from "@open-insurance/core";
import { SqliteCardStore } from "@open-insurance/core/sqlite";

import { parseCachedProfile } from "./cached-profile";
import type { CachedProfile } from "./cached-profile";

export interface DemoSigning {
  issuer: WalletIssuer;
  certificates: SigningCertificates;
}

export interface DemoReaderConfiguration {
  store?: CardStore;
  privateKey?: Buffer | string;
  publicDemo?: {
    passTypeIdentifier: string;
    privateKey: Buffer | string;
    message: string;
    profile?: CachedProfile;
  };
}

const readPublicDemo = async (
  filename: string
): Promise<NonNullable<DemoReaderConfiguration["publicDemo"]>> => {
  const value: unknown = JSON.parse(await readFile(filename, "utf-8"));
  if (
    value === null ||
    typeof value !== "object" ||
    !("passTypeIdentifier" in value) ||
    typeof value.passTypeIdentifier !== "string" ||
    !value.passTypeIdentifier.startsWith("pass.") ||
    !("privateKeyFile" in value) ||
    typeof value.privateKeyFile !== "string" ||
    !("message" in value) ||
    typeof value.message !== "string" ||
    Buffer.byteLength(value.message) < 1 ||
    Buffer.byteLength(value.message) > 64
  ) {
    throw new Error("Invalid public NFC demo configuration.");
  }
  return {
    message: value.message,
    passTypeIdentifier: value.passTypeIdentifier,
    privateKey: await readFile(value.privateKeyFile),
    profile:
      "profileFile" in value && typeof value.profileFile === "string"
        ? parseCachedProfile(
            JSON.parse(await readFile(value.profileFile, "utf-8"))
          )
        : undefined,
  };
};

export const readReaderConfiguration =
  async (): Promise<DemoReaderConfiguration> => {
    const filename = process.env.INSURANCE_CARD_STORE_FILE;
    const privateKeyPath = process.env.INSURANCE_CARD_NFC_PRIVATE_KEY;
    const publicDemoFile = process.env.INSURANCE_CARD_PUBLIC_DEMO_FILE;
    const privateKey =
      privateKeyPath === undefined ? undefined : await readFile(privateKeyPath);
    return {
      privateKey,
      publicDemo:
        publicDemoFile === undefined
          ? undefined
          : await readPublicDemo(publicDemoFile),
      store: filename === undefined ? undefined : new SqliteCardStore(filename),
    };
  };

export const readSigningConfiguration = async (): Promise<
  DemoSigning | undefined
> => {
  const issuer = process.env.INSURANCE_CARD_ISSUER_FILE;
  const cert = process.env.INSURANCE_CARD_SIGNER_CERT;
  const key = process.env.INSURANCE_CARD_SIGNER_KEY;
  const wwdr = process.env.INSURANCE_CARD_WWDR_CERT;
  if (
    issuer === undefined &&
    cert === undefined &&
    key === undefined &&
    wwdr === undefined
  ) {
    return undefined;
  }
  if (
    issuer === undefined ||
    cert === undefined ||
    key === undefined ||
    wwdr === undefined
  ) {
    throw new Error(
      "Wallet signing requires issuer, certificate, private key, and WWDR file paths together."
    );
  }
  const configuration: unknown = JSON.parse(await readFile(issuer, "utf-8"));
  return {
    certificates: {
      signerCert: await readFile(cert),
      signerKey: await readFile(key),
      signerKeyPassphrase: process.env.INSURANCE_CARD_SIGNER_KEY_PASSPHRASE,
      wwdr: await readFile(wwdr),
    },
    issuer: parseWalletIssuer(configuration),
  };
};
