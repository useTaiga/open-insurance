import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";

import Ajv from "ajv";
import { PKPass } from "passkit-generator";
import type { PassProps } from "passkit-generator";

import { summarizeBenefits } from "./intake";
import { parseCardReference } from "./issuer";
import type { IssuedCard } from "./issuer";

export interface WalletIssuer {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  demo?: boolean;
  encryptionPublicKey?: string;
  branding?: {
    background: string;
    foreground: string;
    label: string;
  };
}
export interface SigningCertificates {
  wwdr: Buffer;
  signerCert: Buffer;
  signerKey: Buffer;
  signerKeyPassphrase?: string;
}
export interface WalletPassAssets {
  logo?: Buffer;
  logo2x?: Buffer;
  logo3x?: Buffer;
}

const issuerSchema = {
  additionalProperties: false,
  properties: {
    branding: {
      additionalProperties: false,
      properties: {
        background: { pattern: "^#[0-9a-fA-F]{6}$", type: "string" },
        foreground: { pattern: "^#[0-9a-fA-F]{6}$", type: "string" },
        label: { pattern: "^#[0-9a-fA-F]{6}$", type: "string" },
      },
      required: ["background", "foreground", "label"],
      type: "object",
    },
    demo: { type: "boolean" },
    encryptionPublicKey: { type: "string" },
    organizationName: { minLength: 1, type: "string" },
    passTypeIdentifier: { type: "string" },
    teamIdentifier: { type: "string" },
  },
  required: ["passTypeIdentifier", "teamIdentifier", "organizationName"],
  type: "object",
};
const validateIssuer = new Ajv().compile<WalletIssuer>(issuerSchema);
const color = (hex: string) =>
  `rgb(${[1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(", ")})`;
export const parseWalletIssuer = (value: unknown): WalletIssuer => {
  if (!validateIssuer(value)) {
    throw new Error("Invalid wallet issuer configuration.");
  }
  return value;
};

export const generateNfcKeys = (): {
  privateKey: string;
  encryptionPublicKey: string;
} => {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    encryptionPublicKey: keys.publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }),
  };
};

export const createApplePassJson = (
  card: IssuedCard,
  issuer: WalletIssuer
): PassProps => {
  const message = parseCardReference(card.message);
  if (issuer.encryptionPublicKey !== undefined) {
    const key = createPublicKey({
      format: "der",
      key: Buffer.from(issuer.encryptionPublicKey, "base64"),
      type: "spki",
    });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("encryptionPublicKey must be a P-256 SPKI public key.");
    }
  }
  if (
    !issuer.passTypeIdentifier.startsWith("pass.") ||
    !/^[A-Z0-9]{10}$/u.test(issuer.teamIdentifier)
  ) {
    throw new Error(
      "Use an Apple-issued passTypeIdentifier and ten-character teamIdentifier."
    );
  }
  const patient = card.insurance.dependents?.[0] ?? card.insurance.subscriber;
  return {
    backgroundColor: color(issuer.branding?.background ?? "#15463d"),
    description:
      issuer.demo === true
        ? `${issuer.organizationName} · Fictional prototype`
        : "Health insurance card",
    expirationDate: card.expiresAt,
    foregroundColor: color(issuer.branding?.foreground ?? "#ffffff"),
    formatVersion: 1,
    generic: {
      auxiliaryFields: [
        {
          key: "payer",
          label: "PLAN",
          value:
            card.insurance.tradingPartnerName ??
            card.insurance.tradingPartnerServiceId,
        },
      ],
      backFields: [
        ...(issuer.demo === true
          ? [
              {
                key: "demonstration",
                label: "FICTIONAL PROTOTYPE",
                value:
                  "Created by Taiga for demonstration. Not issued by the named insurer. Member details and benefits are fictional. This card does not establish insurance coverage.",
              },
            ]
          : []),
        {
          key: "policyholder",
          label: "POLICYHOLDER",
          value:
            [
              card.insurance.subscriber.firstName,
              card.insurance.subscriber.lastName,
            ]
              .filter(Boolean)
              .join(" ") || "See issuer",
        },
        ...(card.benefits === undefined
          ? []
          : [
              {
                key: "benefitsAsOf",
                label: "BENEFITS SNAPSHOT",
                value: `Supplied ${card.benefits.asOf}. Snapshot expires ${card.benefits.expiresAt}. Coverage dates below are supplied data; this is not a fresh eligibility check.`,
              },
              ...summarizeBenefits(card.benefits).dates.map(
                (period, index) => ({
                  key: `coverage-${index}`,
                  label: `${period.kind.toUpperCase()} DATES · SUPPLIED SNAPSHOT`,
                  value: period.invalid
                    ? "Conflicting or invalid dates. Review with the issuer."
                    : `Start: ${period.start ?? "Not supplied"}\nEnd: ${period.end ?? "Not supplied"}${period.on === null ? "" : `\nReported date: ${period.on}`}`,
                })
              ),
              {
                key: "credentialExpiry",
                label: "CARD EXPIRATION",
                value: `${card.expiresAt}. This is the credential's expiration, not the insurance coverage end date.`,
              },
            ]),
      ],
      headerFields:
        issuer.demo === true
          ? [{ key: "prototype", label: "", value: "DEMO" }]
          : [],
      primaryFields: [
        {
          key: "patient",
          label: issuer.demo === true ? "FICTIONAL MEMBER" : "MEMBER",
          value:
            [patient.firstName, patient.lastName].filter(Boolean).join(" ") ||
            "Member",
        },
      ],
      secondaryFields: [
        {
          key: "memberId",
          label: "MEMBER ID",
          value: card.insurance.subscriber.memberId ?? "See issuer",
        },
        {
          key: "group",
          label: "GROUP",
          value: card.insurance.subscriber.groupNumber ?? "See issuer",
        },
      ],
    },
    labelColor: color(issuer.branding?.label ?? "#bedece"),
    logoText: issuer.organizationName,
    ...(issuer.encryptionPublicKey === undefined
      ? {}
      : {
          nfc: {
            encryptionPublicKey: issuer.encryptionPublicKey,
            message,
            requiresAuthentication: true,
          },
        }),
    organizationName:
      issuer.demo === true
        ? "Open Insurance by Taiga"
        : issuer.organizationName,
    passTypeIdentifier: issuer.passTypeIdentifier,
    serialNumber: message,
    sharingProhibited: true,
    teamIdentifier: issuer.teamIdentifier,
  };
};

export const signApplePass = async (
  card: IssuedCard,
  issuer: WalletIssuer,
  certificates: SigningCertificates,
  assets: WalletPassAssets = {}
): Promise<Buffer> => {
  const props = createApplePassJson(card, issuer);
  const buffers: Record<string, Buffer> = {
    "icon.png": await readFile(new URL("../assets/icon.png", import.meta.url)),
    "icon@2x.png": await readFile(
      new URL("../assets/icon@2x.png", import.meta.url)
    ),
    "icon@3x.png": await readFile(
      new URL("../assets/icon@3x.png", import.meta.url)
    ),
    "pass.json": Buffer.from(JSON.stringify(props)),
  };
  for (const [field, filename] of [
    ["logo", "logo.png"],
    ["logo2x", "logo@2x.png"],
    ["logo3x", "logo@3x.png"],
  ] as const) {
    const asset = assets[field];
    if (asset !== undefined) {
      buffers[filename] = asset;
    }
  }
  const pass = new PKPass(buffers, certificates);
  return pass.getAsBuffer();
};
