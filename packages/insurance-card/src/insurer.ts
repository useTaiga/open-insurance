import sharp from "sharp";

import type { InsuranceData } from "./contract";
import { InsuranceCardIssuer } from "./issuer";
import type { CardStore } from "./issuer";
import {
  createApplePassJson,
  parseWalletIssuer,
  signApplePass,
} from "./wallet";
import type { SigningCertificates, WalletIssuer } from "./wallet";

export type MemberData = Pick<InsuranceData, "subscriber" | "dependents">;
export interface PayerBrand {
  payerId: string;
  name: string;
  stediId?: string;
  logo?: Buffer;
}
export type PayerDirectory = (payerId: string) => Promise<PayerBrand>;
export interface InsurerOptions {
  payerId: string;
  directory: PayerDirectory;
  wallet: Omit<WalletIssuer, "organizationName">;
  store?: CardStore;
}

export const createInsurer = async (options: InsurerOptions) => {
  if (typeof options.payerId !== "string" || options.payerId.length === 0) {
    throw new Error("Provide a nonempty payer ID string.");
  }
  const payer = structuredClone(await options.directory(options.payerId));
  if (payer.payerId !== options.payerId || !payer.name) {
    throw new Error(
      "The payer directory must resolve the exact configured payer."
    );
  }
  const wallet = parseWalletIssuer({
    ...structuredClone(options.wallet),
    organizationName: payer.name,
  });
  const logo = payer.logo === undefined ? undefined : Buffer.from(payer.logo);
  const logoAt = async (scale: number) =>
    logo === undefined
      ? undefined
      : await sharp(logo)
          .resize(160 * scale, 50 * scale, {
            background: { alpha: 0, b: 0, g: 0, r: 0 },
            fit: "contain",
          })
          .png()
          .toBuffer();
  const [logo1x, logo2x, logo3x] = await Promise.all([
    logoAt(1),
    logoAt(2),
    logoAt(3),
  ]);
  const assets = { logo: logo1x, logo2x, logo3x };
  const issuer = new InsuranceCardIssuer(options.store);
  const resolve = (message: unknown) => {
    const card = issuer.resolve(message);
    if (card.insurance.tradingPartnerServiceId !== payer.payerId) {
      throw new Error("This card belongs to another payer.");
    }
    return card;
  };
  return {
    benefits: (message: unknown, providerNpi?: string) =>
      issuer.benefits(resolve(message).message, providerNpi),
    issue(member: MemberData, expiresAt: Date, benefits?: unknown) {
      const insurance = {
        tradingPartnerName: payer.name,
        tradingPartnerServiceId: payer.payerId,
        ...member,
      };
      if (
        insurance.tradingPartnerServiceId !== payer.payerId ||
        insurance.tradingPartnerName !== payer.name
      ) {
        throw new Error("Member data cannot override the configured payer.");
      }
      return issuer.issue(insurance, expiresAt, benefits);
    },
    pass: (message: unknown) => createApplePassJson(resolve(message), wallet),
    get payer(): PayerBrand {
      return {
        ...payer,
        logo: logo === undefined ? undefined : Buffer.from(logo),
      };
    },
    resolve,
    revoke: (message: unknown) => issuer.revoke(resolve(message).message),
    setBenefits: (message: unknown, value: unknown) =>
      issuer.setBenefits(resolve(message).message, value),
    sign: async (message: unknown, certificates: SigningCertificates) =>
      await signApplePass(resolve(message), wallet, certificates, assets),
  };
};
