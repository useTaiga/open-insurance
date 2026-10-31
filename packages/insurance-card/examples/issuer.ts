import { createEligibilityRequest, createInsurer } from "../src/index";
import {
  benefitsDataSample,
  clinicSample,
  dependentSample,
} from "../src/samples";

const insurer = await createInsurer({
  directory: async (payerId) => ({
    name: "Example Health · Synthetic",
    payerId,
  }),
  payerId: "00001",
  wallet: {
    passTypeIdentifier: "pass.example.insurance",
    teamIdentifier: "EXAMPLE001",
  },
});
const now = new Date();
const card = insurer.issue(
  {
    dependents: dependentSample.dependents,
    subscriber: dependentSample.subscriber,
  },
  new Date(now.getTime() + 86_400_000)
);
insurer.setBenefits(card.message, {
  asOf: now.toISOString(),
  data: benefitsDataSample,
  expiresAt: card.expiresAt,
  format: "stedi-eligibility-legacy",
  insurance: card.insurance,
  source: "issuer",
});
const resolved = insurer.resolve(card.message);
process.stdout.write(
  `${JSON.stringify(
    {
      benefits: insurer.benefits(card.message, clinicSample.billingProviderNpi),
      eligibilitySent: false,
      optionalEligibilityRequest: createEligibilityRequest(
        resolved.insurance,
        clinicSample
      ),
      unsignedWalletPass: insurer.pass(card.message),
    },
    null,
    2
  )}\n`
);
