import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { parseInsuranceData } from "./contract";
import type { InsuranceData } from "./contract";
import type { IssuedCard } from "./issuer";

const snapshotSchema = z.strictObject({
  asOf: z.iso.datetime(),
  data: z.record(z.string(), z.json()),
  expiresAt: z.iso.datetime(),
  format: z.string().min(1),
  insurance: z.unknown(),
  providerNpi: z
    .string()
    .regex(/^\d{10}$/u)
    .optional(),
  source: z.enum(["issuer", "stedi"]),
});
export type BenefitsSnapshot = Omit<
  z.infer<typeof snapshotSchema>,
  "insurance"
> & {
  insurance: InsuranceData;
};

export const parseBenefitsSnapshot = (
  value: unknown,
  insurance: InsuranceData
): BenefitsSnapshot => {
  const snapshot = snapshotSchema.parse(value);
  const subject = parseInsuranceData(snapshot.insurance);
  if (!isDeepStrictEqual(subject, insurance)) {
    throw new Error(
      "Benefits must match this card's payer and patient insurance data."
    );
  }
  if (Date.parse(snapshot.expiresAt) <= Date.parse(snapshot.asOf)) {
    throw new Error("Benefits expiration must be later than its as-of time.");
  }
  return structuredClone({ ...snapshot, insurance: subject });
};

export const readCardBenefits = (card: IssuedCard, providerNpi?: string) => {
  if (card.benefits === undefined) {
    return undefined;
  }
  const snapshot = parseBenefitsSnapshot(card.benefits, card.insurance);
  if (
    snapshot.providerNpi !== undefined &&
    snapshot.providerNpi !== providerNpi
  ) {
    throw new Error("These benefits belong to a different provider context.");
  }
  let freshness: "not-yet-valid" | "expired" | "within-validity" =
    "within-validity";
  if (Date.parse(snapshot.asOf) > Date.now()) {
    freshness = "not-yet-valid";
  } else if (Date.parse(snapshot.expiresAt) <= Date.now()) {
    freshness = "expired";
  }
  return { freshness, snapshot };
};
