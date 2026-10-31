import { parseClinicContext, parseInsuranceData } from "@open-insurance/core";
import { eligibilityResultSchema } from "@open-insurance/contracts/eligibility-result";
import { z } from "zod";

const profileSchema = z.object({
  checkedAt: z.iso.datetime(),
  clinic: z.unknown(),
  insurance: z.unknown(),
  providerNpi: z.string(),
  result: eligibilityResultSchema.extend({
    plan: eligibilityResultSchema.shape.plan.extend({ memberId: z.string() }),
  }),
});

export const parseCachedProfile = (value: unknown) => {
  const profile = profileSchema.parse(value);
  const clinic = parseClinicContext(profile.clinic);
  const insurance = parseInsuranceData(profile.insurance);
  if (
    clinic.billingProviderNpi !== profile.providerNpi ||
    profile.result.plan.memberId !== insurance.subscriber.memberId
  ) {
    throw new Error(
      "The saved eligibility result must match the member and provider scope."
    );
  }
  return { ...profile, clinic, insurance };
};

export type CachedProfile = ReturnType<typeof parseCachedProfile>;
