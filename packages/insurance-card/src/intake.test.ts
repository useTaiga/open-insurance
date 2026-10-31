import { expect, test } from "bun:test";

import { summarizeBenefits } from "./intake";
import { InsuranceCardIssuer } from "./issuer";
import {
  benefitsDataSample,
  benefitsPlansSample,
  dependentSample,
} from "./samples";
import { createApplePassJson } from "./wallet";

const cardWith = (data: Record<string, unknown>) => {
  const issuer = new InsuranceCardIssuer();
  return issuer.issue(dependentSample, new Date("2099-01-01"), {
    asOf: "2026-10-01T00:00:00Z",
    data,
    expiresAt: "2026-10-02T00:00:00Z",
    format: "stedi",
    insurance: dependentSample,
    source: "issuer",
  });
};
const summary = (data: Record<string, unknown>) => {
  const card = cardWith(data);
  if (!card.benefits) {
    throw new Error("Expected supplied benefits.");
  }
  return summarizeBenefits(card.benefits);
};

test.each([
  { data: benefitsDataSample, shape: "legacy", start: "2026-01-01" },
  { data: benefitsPlansSample, shape: "plans", start: "2026-04-01" },
])(
  "$shape dates preserve patient scope, per-benefit dates and separate financial accumulators",
  ({ data, shape, start }) => {
    const result = summary(data);
    expect(result.shape).toBe(shape);
    expect(result.issues).toEqual([]);
    expect(result.dates.find((period) => period.kind === "plan")).toMatchObject(
      { end: "2026-12-31", start }
    );
    expect(
      result.dates.find((period) => period.kind === "eligibility")
    ).toMatchObject({ end: "2026-11-30" });
    const benefits = result.plans.flatMap((plan) => plan.benefits);
    expect(
      benefits.find((benefit) => benefit.category === "coPayment")?.dates[0]
    ).toMatchObject({
      end: "2026-11-30",
      kind: "benefit",
      start: "2026-07-01",
    });
    expect(
      benefits
        .filter((benefit) => benefit.category === "outOfPocket")
        .map((benefit) => [
          benefit.amount,
          benefit.coverageLevel,
          benefit.timePeriod,
        ])
    ).toEqual(
      shape === "legacy"
        ? [
            ["6000.00", "Individual", "Calendar Year"],
            ["4000.00", "Individual", "Remaining"],
            ["12000.00", "Family", "Calendar Year"],
          ]
        : [
            ["6000.00", "INDIVIDUAL", "CALENDAR_YEAR"],
            ["4000.00", "INDIVIDUAL", "REMAINING"],
            ["12000.00", "FAMILY", "CALENDAR_YEAR"],
          ]
    );
    expect(
      benefits.find((benefit) => benefit.category === "coInsurance")?.percent
    ).toBe("0.20");
  }
);

test("missing dependent dates never inherit subscriber dates; zero amounts and unknown fields survive unchanged", () => {
  const data = {
    ...structuredClone(benefitsPlansSample),
    dependent: {},
    futurePayerField: { values: ["0001"] },
  };
  data.plans[0].benefits.deductible[0].amount = "0";
  const card = cardWith(data);
  if (!card.benefits) {
    throw new Error("Expected benefits.");
  }
  const result = summarizeBenefits(card.benefits);
  expect(result.dates).toEqual([]);
  expect(result.issues).toContain(
    "Dependent dates were not supplied; subscriber dates have not been substituted."
  );
  expect(
    result.plans[0]?.benefits.find(
      (benefit) => benefit.category === "deductible"
    )?.amount
  ).toBe("0");
  expect(card.benefits.data).toEqual(data);
});

test.each([
  {
    end: null,
    input: { planBegin: "20260230" },
    invalid: true,
    on: null,
    start: null,
  },
  {
    end: null,
    input: { planBegin: "20260101" },
    invalid: false,
    on: null,
    start: "2026-01-01",
  },
  {
    end: "2026-12-31",
    input: { plan: "20260101-20261231" },
    invalid: false,
    on: null,
    start: "2026-01-01",
  },
  {
    end: null,
    input: { plan: "20260101" },
    invalid: false,
    on: "2026-01-01",
    start: null,
  },
  {
    end: "2026-01-01",
    input: { planBegin: "20261231", planEnd: "20260101" },
    invalid: true,
    on: null,
    start: "2026-12-31",
  },
  {
    end: "2026-12-31",
    input: { plan: "20260101-20261231", planBegin: "20260201" },
    invalid: true,
    on: null,
    start: "2026-02-01",
  },
])(
  "coverage date parsing preserves missing, point, invalid and conflicting dates: $input",
  ({ input, ...expected }) => {
    const result = summary({
      benefitsInformation: [],
      planDateInformation: input,
    });
    expect(result.dates[0]).toMatchObject(expected);
  }
);

test("Wallet coverage dates carry provenance and cannot be confused with credential or snapshot expiration", () => {
  const card = cardWith(benefitsDataSample);
  const pass = createApplePassJson(card, {
    organizationName: "Example",
    passTypeIdentifier: "pass.example.insurance",
    teamIdentifier: "EXAMPLE123",
  });
  expect(pass.expirationDate).toBe("2099-01-01T00:00:00.000Z");
  expect(
    pass.generic?.backFields?.find((field) => field.key === "coverage-0")
  ).toMatchObject({
    label: "PLAN DATES · SUPPLIED SNAPSHOT",
    value: "Start: 2026-01-01\nEnd: 2026-12-31",
  });
  expect(
    pass.generic?.backFields?.find((field) => field.key === "benefitsAsOf")
      ?.value
  ).toContain("2026-10-02");
});
