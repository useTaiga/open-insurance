import { afterEach, describe, expect, setSystemTime, test } from "bun:test";

import {
  createApplePassJson,
  createEligibilityRequest,
  generateNfcKeys,
  InsuranceCardIssuer,
  parseWalletIssuer,
} from "./index";
import { clinicSample, dependentSample, subscriberSample } from "./samples";

afterEach(() => setSystemTime());

test("a standard Wallet template preserves the member data without requiring NFC permission", () => {
  const card = new InsuranceCardIssuer().issue(
    dependentSample,
    new Date(Date.now() + 60_000)
  );
  const configuration = {
    organizationName: "Insurance Prototype",
    passTypeIdentifier: "pass.org.openinsurance.test",
    teamIdentifier: "EXAMPLE001",
  };
  const pass = createApplePassJson(card, parseWalletIssuer(configuration));
  expect(pass).not.toHaveProperty("nfc");
  expect(pass.generic?.primaryFields?.[0]?.value).toBe("JAMIE MORGAN");
  expect(pass.generic?.secondaryFields?.[0]?.value).toBe("0000123456");
  expect(pass.generic?.secondaryFields?.[1]?.value).toBe("000987");
  expect(pass.generic?.backFields?.[0]?.value).toBe("CASEY MORGAN");
  expect(pass.serialNumber).toBe(card.message);
  expect(() =>
    parseWalletIssuer({ ...configuration, encryptionPublicKey: null })
  ).toThrow();
});

describe("issuer → NFC reference → Stedi request", () => {
  test.each([
    ["subscriber", subscriberSample],
    ["dependent", dependentSample],
    [
      "payer-specific fields",
      {
        ...subscriberSample,
        subscriber: {
          ...subscriberSample.subscriber,
          address: {
            address1: "123 Example Street",
            city: "ANYTOWN",
            postalCode: "08001",
            state: "NJ",
          },
          idCard: "00098765",
          middleName: "A",
        },
      },
    ],
  ] as const)(
    "preserves %s fields without renaming or coercion",
    (_name, data) => {
      const issuer = new InsuranceCardIssuer();
      const card = issuer.issue(data, new Date(Date.now() + 60_000));
      const keys = generateNfcKeys();
      const pass = createApplePassJson(card, {
        encryptionPublicKey: keys.encryptionPublicKey,
        organizationName: "Example Health",
        passTypeIdentifier: "pass.org.openinsurance.test",
        teamIdentifier: "EXAMPLE001",
      });
      const serialized = JSON.stringify(pass);
      const received: unknown = JSON.parse(serialized);
      if (
        received === null ||
        typeof received !== "object" ||
        !("nfc" in received) ||
        received.nfc === null ||
        typeof received.nfc !== "object" ||
        !("message" in received.nfc)
      ) {
        throw new Error("Serialized pass is missing its NFC message.");
      }
      const resolved = issuer.resolve(received.nfc.message);
      expect(
        createEligibilityRequest(resolved.insurance, clinicSample)
      ).toEqual({
        ...data,
        encounter: clinicSample.encounter,
        provider: clinicSample.provider,
      });
      expect(Buffer.byteLength(card.message)).toBeLessThanOrEqual(64);
      expect(card.message).not.toContain(data.subscriber.memberId);
      expect(pass.nfc?.requiresAuthentication).toBe(true);
    }
  );

  test.each([
    [
      "numeric member IDs",
      {
        ...subscriberSample,
        subscriber: { ...subscriberSample.subscriber, memberId: 123_456 },
      },
    ],
    [
      "incorrect date format",
      {
        ...subscriberSample,
        subscriber: {
          ...subscriberSample.subscriber,
          dateOfBirth: "1985-05-27",
        },
      },
    ],
    [
      "renamed fields",
      {
        ...subscriberSample,
        subscriber: { ...subscriberSample.subscriber, member_id: "123456" },
      },
    ],
    [
      "a provider supplied by the issuer",
      { ...subscriberSample, provider: clinicSample.provider },
    ],
    [
      "multiple dependent patients",
      {
        ...dependentSample,
        dependents: [
          dependentSample.dependents?.[0],
          dependentSample.dependents?.[0],
        ],
      },
    ],
    ["an unidentified subscriber", { ...subscriberSample, subscriber: {} }],
  ] as const)("rejects %s", (_name, data) => {
    expect(() =>
      new InsuranceCardIssuer().issue(data, new Date(Date.now() + 60_000))
    ).toThrow();
  });

  test("blocks clinic scope mismatch and preserves clinic-only fields", () => {
    expect(() =>
      createEligibilityRequest(subscriberSample, {
        ...clinicSample,
        billingProviderNpi: "1023169455",
      })
    ).toThrow("scope");
    const clinic = { ...clinicSample, externalPatientId: "clinic-patient-123" };
    expect(
      createEligibilityRequest(subscriberSample, clinic).externalPatientId
    ).toBe("clinic-patient-123");
  });

  test("revocation, expiry, and mutation of returned records cannot change the issuer record", () => {
    setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const issuer = new InsuranceCardIssuer();
    const card = issuer.issue(
      subscriberSample,
      new Date("2030-01-01T01:00:00Z")
    );
    card.insurance.subscriber.memberId = "CHANGED";
    expect(issuer.resolve(card.message).insurance.subscriber.memberId).toBe(
      subscriberSample.subscriber.memberId
    );
    const revoked = issuer.issue(
      dependentSample,
      new Date("2030-01-01T01:00:00Z")
    );
    issuer.revoke(revoked.message);
    expect(() => issuer.resolve(revoked.message)).toThrow("revoked");
    setSystemTime(new Date("2030-01-01T01:00:00Z"));
    expect(() => issuer.resolve(card.message)).toThrow("expired");
    expect(() => issuer.resolve("ic1_invalid")).toThrow("Invalid");
  });
});
