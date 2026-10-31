import { z } from "zod";

const optionalString = z.string().optional();

export const eligibilityBenefitSchema = z.object({
  amount: optionalString,
  code: optionalString,
  coverageLevel: optionalString,
  name: z.string(),
  network: optionalString,
  notes: z.array(z.string()),
  percent: optionalString,
  quantity: optionalString,
  quantityQualifier: optionalString,
  serviceTypeCodes: z.array(z.string()),
  serviceTypes: z.array(z.string()),
  timeQualifier: optionalString,
});

export const eligibilityResultSchema = z.object({
  benefits: z.array(eligibilityBenefitSchema),
  errors: z.array(
    z.object({
      code: optionalString,
      description: z.string(),
      resolution: optionalString,
    })
  ),
  plan: z.object({
    endDate: optionalString,
    groupNumber: optionalString,
    insuranceType: optionalString,
    memberId: optionalString,
    name: optionalString,
    payerName: optionalString,
    startDate: optionalString,
  }),
  status: z.enum(["ACTIVE", "INACTIVE", "UNKNOWN"]),
});

export type EligibilityBenefit = z.infer<typeof eligibilityBenefitSchema>;
export type EligibilityResult = z.infer<typeof eligibilityResultSchema>;
