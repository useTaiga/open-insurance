import type { ClinicContext, InsuranceData } from "./contract";

export { default as benefitsDataSample } from "./fixtures/benefits.json";

export const subscriberSample: InsuranceData = {
  subscriber: {
    dateOfBirth: "19850527",
    firstName: "CASEY",
    groupNumber: "000987",
    lastName: "MORGAN",
    memberId: "0000123456",
  },
  tradingPartnerName: "Example Health · Synthetic",
  tradingPartnerServiceId: "00001",
};

export const dependentSample: InsuranceData = {
  ...subscriberSample,
  dependents: [
    {
      dateOfBirth: "20120304",
      firstName: "JAMIE",
      individualRelationshipCode: "19",
      lastName: "MORGAN",
    },
  ],
};

export const clinicSample: ClinicContext = {
  billingProviderNpi: "1999999984",
  encounter: { serviceTypeCodes: ["30"] },
  provider: { npi: "1999999984", organizationName: "Example Clinic" },
};
