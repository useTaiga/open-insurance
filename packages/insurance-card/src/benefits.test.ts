import { expect, test } from "bun:test";

import { createInsurer, InsuranceCardIssuer, readCardBenefits } from "./index";
import type { IssuedCard } from "./index";
import { benefitsDataSample, dependentSample } from "./samples";

const snapshot = {
  asOf: "2020-01-01T00:00:00Z",
  data: {
    ...benefitsDataSample,
    payerExtension: {
      limits: [{ notes: ["Retain every nested field."], quantity: "0002" }],
    },
  },
  expiresAt: "2020-01-02T00:00:00Z",
  format: "stedi-eligibility-legacy",
  insurance: dependentSample,
  source: "issuer" as const,
};
const directory = async (payerId: string) => ({
  name: "Example Health",
  payerId,
});

test.each(["issuer", "stedi"] as const)(
  "%s benefits survive resolution losslessly, retain provenance and report expired validity",
  (source) => {
    const issuer = new InsuranceCardIssuer();
    const card = issuer.issue(dependentSample, new Date(Date.now() + 60_000));
    const supplied = { ...snapshot, source };
    issuer.setBenefits(card.message, supplied);
    const read = issuer.benefits(card.message);
    const response: unknown = read;
    expect(response).toEqual({ freshness: "expired", snapshot: supplied });
    if (read !== undefined) {
      read.snapshot.data.benefitsInformation = [];
    }
    const retained: unknown = issuer.benefits(card.message)?.snapshot.data;
    expect(retained).toEqual(supplied.data);
    issuer.revoke(card.message);
    expect(() => issuer.benefits(card.message)).toThrow("revoked");
  }
);

test("benefits cannot be attached to another payer or dependent, or used for another provider", () => {
  const issuer = new InsuranceCardIssuer();
  const card = issuer.issue(dependentSample, new Date(Date.now() + 60_000));
  for (const insurance of [
    { ...dependentSample, tradingPartnerServiceId: "OTHER" },
    {
      ...dependentSample,
      dependents: [{ ...dependentSample.dependents?.[0], firstName: "OTHER" }],
    },
  ]) {
    expect(() =>
      issuer.setBenefits(card.message, { ...snapshot, insurance })
    ).toThrow("patient");
  }
  issuer.setBenefits(card.message, { ...snapshot, providerNpi: "1999999984" });
  for (const providerNpi of [undefined, "1023169455"]) {
    expect(() => issuer.benefits(card.message, providerNpi)).toThrow(
      "provider context"
    );
  }
  expect(issuer.benefits(card.message, "1999999984")?.freshness).toBe(
    "expired"
  );
  expect(() =>
    issuer.setBenefits(card.message, {
      ...snapshot,
      data: { invalid: undefined },
    })
  ).toThrow();
  expect(() =>
    issuer.setBenefits(card.message, { ...snapshot, expiresAt: snapshot.asOf })
  ).toThrow("expiration");
});

test("insurer benefit updates enforce payer scope and expose supplied validity without a payer inquiry", async () => {
  const store = new Map<string, IssuedCard>();
  const wallet = {
    passTypeIdentifier: "pass.example.insurance",
    teamIdentifier: "EXAMPLE001",
  };
  const first = await createInsurer({
    directory,
    payerId: "00001",
    store,
    wallet,
  });
  const other = await createInsurer({
    directory,
    payerId: "00002",
    store,
    wallet,
  });
  const card = first.issue(
    {
      dependents: dependentSample.dependents,
      subscriber: dependentSample.subscriber,
    },
    new Date(Date.now() + 60_000)
  );
  first.setBenefits(card.message, {
    ...snapshot,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    insurance: card.insurance,
  });
  expect(first.benefits(card.message)?.freshness).toBe("within-validity");
  for (const operation of [
    () => other.setBenefits(card.message, snapshot),
    () => other.benefits(card.message),
  ]) {
    expect(operation).toThrow("another payer");
  }
  const resolved: unknown = readCardBenefits(first.resolve(card.message))
    ?.snapshot.data;
  expect(resolved).toEqual(snapshot.data);
  first.setBenefits(card.message, {
    ...snapshot,
    asOf: new Date(Date.now() + 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    insurance: card.insurance,
  });
  expect(first.benefits(card.message)?.freshness).toBe("not-yet-valid");
});
