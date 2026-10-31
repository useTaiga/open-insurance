import type { EligibilityRequest, IssuedCard } from "@open-insurance/core";
import type { EligibilityResult as ReaderEligibility } from "@open-insurance/contracts/eligibility-result";

export type SimulationScenario = "active" | "inactive" | "rejected";

export type { EligibilityResult as ReaderEligibility } from "@open-insurance/contracts/eligibility-result";

export interface ReaderResult {
  mode: "simulation" | "prepared" | "cached";
  checkedAt?: string;
  sent: false;
  request: EligibilityRequest;
  memberName: string;
  eligibility?: ReaderEligibility;
}

export const preparedReaderResult = (
  card: IssuedCard,
  request: EligibilityRequest
): ReaderResult => {
  const patient = card.insurance.dependents?.[0] ?? card.insurance.subscriber;
  return {
    memberName:
      [patient.firstName, patient.lastName].filter(Boolean).join(" ") ||
      "Member",
    mode: "prepared",
    request,
    sent: false,
  };
};

export const simulateReaderResult = (
  card: IssuedCard,
  request: EligibilityRequest,
  scenario: SimulationScenario
): ReaderResult => ({
  ...preparedReaderResult(card, request),
  eligibility: {
    benefits:
      scenario === "active"
        ? [
            {
              amount: "25.00",
              code: "B",
              coverageLevel: "Individual",
              name: "Co-Payment",
              network: "Yes",
              notes: ["Synthetic office visit benefit. Not an amount due."],
              serviceTypeCodes: ["98"],
              serviceTypes: ["Professional (Physician) Visit - Office"],
            },
            {
              amount: "1500.00",
              code: "C",
              coverageLevel: "Individual",
              name: "Deductible",
              network: "Yes",
              notes: [],
              serviceTypeCodes: ["30"],
              serviceTypes: ["Health Benefit Plan Coverage"],
              timeQualifier: "Calendar Year",
            },
            {
              amount: "750.00",
              code: "C",
              coverageLevel: "Individual",
              name: "Deductible",
              network: "Yes",
              notes: [],
              serviceTypeCodes: ["30"],
              serviceTypes: ["Health Benefit Plan Coverage"],
              timeQualifier: "Remaining",
            },
            {
              amount: "6000.00",
              code: "G",
              coverageLevel: "Individual",
              name: "Out of Pocket (Stop Loss)",
              network: "Yes",
              notes: [],
              serviceTypeCodes: ["30"],
              serviceTypes: ["Health Benefit Plan Coverage"],
              timeQualifier: "Calendar Year",
            },
            {
              code: "A",
              coverageLevel: "Individual",
              name: "Co-Insurance",
              network: "Yes",
              notes: [],
              percent: "0.20",
              serviceTypeCodes: ["30"],
              serviceTypes: ["Health Benefit Plan Coverage"],
            },
          ]
        : [],
    errors:
      scenario === "rejected"
        ? [
            {
              code: "75",
              description: "Synthetic payer response: subscriber not found.",
              resolution:
                "Verify the policyholder information before another inquiry.",
            },
          ]
        : [],
    plan: {
      groupNumber: card.insurance.subscriber.groupNumber,
      insuranceType: "Preferred Provider Organization (PPO)",
      memberId: card.insurance.subscriber.memberId,
      name: "Example Health PPO · Synthetic",
      payerName: card.insurance.tradingPartnerName,
      startDate: "20260101",
    },
    status: (
      { active: "ACTIVE", inactive: "INACTIVE", rejected: "UNKNOWN" } as const
    )[scenario],
  },
  mode: "simulation",
});
