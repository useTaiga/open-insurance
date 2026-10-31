import { readFile } from "node:fs/promises";

import { createInsurer } from "../src/index";
import type { InsurerOptions } from "../src/index";
import {
  benefitsDataSample,
  dependentSample,
  subscriberSample,
} from "../src/samples";

export const partnerPrototypes = [
  {
    background: "#6d39d9",
    name: "Angle Health",
    payerId: "39856",
    slug: "angle",
    stediId: "JZIRA",
  },
  {
    background: "#fc5c50",
    name: "Curative",
    payerId: "CURTV",
    slug: "curative",
    stediId: "ESEPO",
  },
  {
    background: "#5547ff",
    name: "Oscar Health",
    payerId: "OSCAR",
    slug: "oscar",
    stediId: "TAZWT",
  },
] as const;

export const createPartnerPrototype = async (
  partner: (typeof partnerPrototypes)[number],
  wallet: Pick<
    InsurerOptions["wallet"],
    "passTypeIdentifier" | "teamIdentifier"
  >,
  dependent: boolean
) => {
  const identifiers = {
    passTypeIdentifier: wallet.passTypeIdentifier,
    teamIdentifier: wallet.teamIdentifier,
  };
  const logo = await readFile(
    new URL(`../assets/prototypes/${partner.slug}.png`, import.meta.url)
  );
  const branding = {
    background: partner.background,
    foreground: "#ffffff",
    label: "#ffffff",
  };
  const issuer = await createInsurer({
    directory: async () => ({
      logo,
      name: partner.name,
      payerId: partner.payerId,
      stediId: partner.stediId,
    }),
    payerId: partner.payerId,
    wallet: { ...identifiers, branding, demo: true },
  });
  const now = new Date();
  const member = dependent ? dependentSample : subscriberSample;
  const card = issuer.issue(
    {
      subscriber: {
        ...member.subscriber,
        groupNumber: "DEMO000987",
        memberId: "DEMO0000123456",
      },
      ...(member.dependents === undefined
        ? {}
        : { dependents: member.dependents }),
    },
    new Date(now.getTime() + 30 * 86_400_000)
  );
  issuer.setBenefits(card.message, {
    asOf: now.toISOString(),
    data: {
      ...structuredClone(benefitsDataSample),
      demo: true,
      payer: { name: partner.name },
      subscriber: {
        groupNumber: card.insurance.subscriber.groupNumber,
        memberId: card.insurance.subscriber.memberId,
      },
    },
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
    format: "stedi-eligibility-legacy",
    insurance: card.insurance,
    source: "issuer",
  });
  return {
    card: issuer.resolve(card.message),
    issuer,
    logo,
    wallet: {
      ...identifiers,
      branding,
      demo: true,
      organizationName: partner.name,
    },
  };
};
