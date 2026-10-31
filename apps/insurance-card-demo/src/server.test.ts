import { expect, test } from "bun:test";

import {
  dependentSample,
  clinicSample,
  benefitsDataSample,
} from "@open-insurance/core/samples";
import { z } from "zod";

import { createDemo } from "./server";

test("a read returns all supplied benefits without sending an inquiry and rejects another provider context", async () => {
  const app = createDemo();
  const post = async (path: string, input: unknown) =>
    await app.fetch(
      new Request(`http://localhost${path}`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
  const issuedResponse = await post("/api/issue", dependentSample);
  const issued = z
    .object({ card: z.object({ message: z.string() }) })
    .parse(await issuedResponse.json());
  const snapshot = {
    asOf: "2020-01-01T00:00:00Z",
    data: benefitsDataSample,
    expiresAt: "2020-01-02T00:00:00Z",
    format: "stedi-eligibility-legacy",
    insurance: dependentSample,
    source: "issuer",
  };
  const attached = await post("/api/benefits", {
    message: issued.card.message,
    snapshot,
  });
  expect(attached.status).toBe(200);
  const read = await post("/api/reader/read", { message: issued.card.message });
  expect(await read.json()).toMatchObject({
    benefits: { freshness: "expired", snapshot },
    sent: false,
  });
  await post("/api/benefits", {
    message: issued.card.message,
    snapshot: { ...snapshot, providerNpi: "1023169455" },
  });
  const rejected = await post("/api/reader/read", {
    message: issued.card.message,
  });
  expect(rejected.status).toBe(400);
  const stateResponse = await app.fetch(
    new Request("http://localhost/api/state")
  );
  expect(await stateResponse.json()).not.toHaveProperty("readerResult");
});

test("an unsigned Wallet preview cannot be downloaded as an installable pass", async () => {
  const app = createDemo();
  const response = await app.fetch(
    new Request("http://localhost/api/wallet/pass.pkpass")
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("content-type")).not.toBe(
    "application/vnd.apple.pkpass"
  );
});

test("the reader endpoint prepares the exact dependent inquiry and rejects a revoked credential", async () => {
  const app = createDemo();
  const post = async (path: string, input: unknown) =>
    await app.fetch(
      new Request(`http://127.0.0.1:4320${path}`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
  const issued = await post("/api/issue", dependentSample);
  const result: unknown = await issued.json();
  if (
    result === null ||
    typeof result !== "object" ||
    !("card" in result) ||
    result.card === null ||
    typeof result.card !== "object" ||
    !("message" in result.card)
  ) {
    throw new Error("Missing issued card reference.");
  }
  expect(issued.status).toBe(200);
  const read = await post("/api/tap", { message: result.card.message });
  expect(await read.json()).toEqual({
    message: result.card.message,
    request: {
      ...dependentSample,
      encounter: clinicSample.encounter,
      provider: clinicSample.provider,
    },
    sent: false,
    status: "prepared",
  });
  const native = await post("/api/reader/read", {
    message: result.card.message,
  });
  expect(await native.json()).toEqual({
    memberName: "JAMIE MORGAN",
    mode: "prepared",
    request: {
      ...dependentSample,
      encounter: clinicSample.encounter,
      provider: clinicSample.provider,
    },
    sent: false,
  });
  await post("/api/revoke", { message: result.card.message });
  const revokedRead = await post("/api/tap", { message: result.card.message });
  expect(revokedRead.status).toBe(400);
  const injected = await post("/api/issue", {
    ...dependentSample,
    provider: clinicSample.provider,
  });
  expect(injected.status).toBe(400);
});

test.each([
  ["active", "ACTIVE", 5, 0],
  ["inactive", "INACTIVE", 0, 0],
  ["rejected", "UNKNOWN", 0, 1],
] as const)(
  "the native reader receives an explicitly simulated %s result",
  async (scenario, status, benefits, errors) => {
    const app = createDemo();
    const response = await app.fetch(
      new Request("http://localhost/api/reader/simulate", {
        body: JSON.stringify({ scenario }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
    const result: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({
      eligibility: {
        benefits: { length: benefits },
        errors: { length: errors },
        plan: { groupNumber: "000987", memberId: "0000123456" },
        status,
      },
      memberName: "JAMIE MORGAN",
      mode: "simulation",
      request: {
        ...dependentSample,
        encounter: clinicSample.encounter,
        provider: clinicSample.provider,
      },
      sent: false,
    });
  }
);

test("the native reader cannot turn an unavailable VAS decoder into eligibility", async () => {
  const app = createDemo();
  const response = await app.fetch(
    new Request("http://localhost/api/reader/vas", {
      body: JSON.stringify({ vasDataBase64: "AQI=" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual({
    error:
      "Apple VAS decryption is not configured. No card was resolved and no eligibility inquiry was sent.",
  });
});

test("physical tags resolve their linked card, preserve policyholder fields, and reject revoked or unknown tags", async () => {
  const app = createDemo();
  const post = async (path: string, input: unknown) =>
    await app.fetch(
      new Request(`http://localhost${path}`, {
        body: JSON.stringify(input),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      })
    );
  const identifier = "01020304";
  const premature = await post("/api/reader/tag/enroll", { identifier });
  expect(premature.status).toBe(400);
  await post("/api/issue", dependentSample);
  const linked = await post("/api/reader/tag/enroll", { identifier });
  expect(await linked.json()).toEqual({ linked: true, sent: false });
  await post("/api/issue", {
    ...dependentSample,
    subscriber: { ...dependentSample.subscriber, memberId: "another-card" },
  });
  const read = await post("/api/reader/tag/read", { identifier });
  expect(await read.json()).toEqual({
    memberName: "JAMIE MORGAN",
    mode: "prepared",
    request: {
      ...dependentSample,
      encounter: clinicSample.encounter,
      provider: clinicSample.provider,
    },
    sent: false,
  });
  const stateResponse = await app.fetch(
    new Request("http://localhost/api/state")
  );
  const state: unknown = await stateResponse.json();
  expect(state).toMatchObject({
    currentCard: { insurance: dependentSample },
    tagLinked: true,
  });
  for (const invalid of [
    "aabbccdd",
    "",
    "0102",
    { provider: clinicSample.provider },
  ]) {
    await post("/api/reader/tag/read", { identifier });
    const rejected = await post("/api/reader/tag/read", {
      identifier: invalid,
    });
    expect(rejected.status).toBe(400);
    const afterFailure = await app.fetch(
      new Request("http://localhost/api/state")
    );
    const cleared: unknown = await afterFailure.json();
    expect(cleared).not.toHaveProperty("request");
  }
  if (
    state === null ||
    typeof state !== "object" ||
    !("currentCard" in state) ||
    state.currentCard === null ||
    typeof state.currentCard !== "object" ||
    !("message" in state.currentCard)
  ) {
    throw new Error("Missing linked card.");
  }
  await post("/api/revoke", { message: state.currentCard.message });
  const revoked = await post("/api/reader/tag/read", { identifier });
  expect(revoked.status).toBe(400);
});
