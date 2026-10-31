import { expect, test } from "bun:test";
import { createECDH, createPrivateKey } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { IssuedCard } from "@open-insurance/core";
import fixture from "@open-insurance/core/fixtures/vas";
import { clinicSample, dependentSample } from "@open-insurance/core/samples";
import { SqliteCardStore } from "@open-insurance/core/sqlite";
import { z } from "zod";

import { parseCachedProfile } from "./cached-profile";
import { createDemo } from "./server";
import type { DemoSigning } from "./signing";

const privateKey = (scalar: number): string => {
  const bytes = Buffer.alloc(32);
  bytes[31] = scalar;
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(bytes);
  const publicBytes = curve.getPublicKey();
  return createPrivateKey({
    format: "jwk",
    key: {
      crv: "P-256",
      d: bytes.toString("base64url"),
      kty: "EC",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33, 65).toString("base64url"),
    },
  }).export({ format: "pem", type: "pkcs8" });
};

const signing: DemoSigning = {
  certificates: {
    signerCert: Buffer.alloc(0),
    signerKey: Buffer.alloc(0),
    wwdr: Buffer.alloc(0),
  },
  issuer: {
    organizationName: "Example Health",
    passTypeIdentifier: fixture.passTypeIdentifier,
    teamIdentifier: "EXAMPLE001",
  },
};
const card: IssuedCard = {
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  insurance: dependentSample,
  message: fixture.message,
};
const request = {
  ...dependentSample,
  encounter: clinicSample.encounter,
  provider: clinicSample.provider,
};
const envelope = (cryptogramHex: string) => ({
  mobileTokenBase64: "",
  passTypeIdentifier: fixture.passTypeIdentifier,
  vasDataBase64: Buffer.from(cryptogramHex, "hex").toString("base64"),
});
const post = async (
  app: ReturnType<typeof createDemo>,
  pathname: string,
  input: unknown
) =>
  await app.fetch(
    new Request(`http://127.0.0.1:4320${pathname}`, {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    })
  );
const state = async (app: ReturnType<typeof createDemo>): Promise<unknown> => {
  const response = await app.fetch(
    new Request("http://127.0.0.1:4320/api/state")
  );
  return await response.json();
};

test.each(fixture.cryptograms)(
  "independent VAS method $method resolves the seeded opaque reference without sending eligibility",
  async ({ cryptogramHex }) => {
    const app = createDemo(signing, {
      privateKey: privateKey(1),
      store: new Map([[card.message, card]]),
    });
    const response = await post(
      app,
      "/api/reader/vas",
      envelope(cryptogramHex)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      memberName: "JAMIE MORGAN",
      mode: "prepared",
      request,
      sent: false,
    });
    expect(await state(app)).toMatchObject({
      currentCard: card,
      nfcPassReady: false,
      request,
      vasReady: true,
    });
    const config = await app.fetch(
      new Request("http://127.0.0.1:4320/api/reader/config")
    );
    expect(await config.json()).toMatchObject({
      eligibilityReady: false,
      nfcPassReady: false,
      vasReady: true,
    });
  }
);

test("wrong issuer, authentication tag tampering, malformed reads and revoked references clear stale preparation", async () => {
  const store = new Map([[card.message, card]]);
  const app = createDemo(signing, { privateKey: privateKey(1), store });
  const [{ cryptogramHex }] = fixture.cryptograms;
  const altered = Buffer.from(cryptogramHex, "hex");
  altered[altered.length - 1] = ((altered.at(-1) ?? 0) + 1) % 256;
  for (const invalid of [
    { ...envelope(cryptogramHex), passTypeIdentifier: "pass.another.issuer" },
    envelope(altered.toString("hex")),
    { ...envelope(cryptogramHex), mobileTokenBase64: "!" },
  ]) {
    const prepared = await post(
      app,
      "/api/reader/vas",
      envelope(cryptogramHex)
    );
    expect(prepared.status).toBe(200);
    const rejected = await post(app, "/api/reader/vas", invalid);
    expect(rejected.status).toBe(400);
    expect(await state(app)).not.toHaveProperty("request");
  }
  await post(app, "/api/reader/vas", envelope(cryptogramHex));
  await post(app, "/api/revoke", { message: card.message });
  const revoked = await post(app, "/api/reader/vas", envelope(cryptogramHex));
  expect(revoked.status).toBe(400);
  expect(await state(app)).not.toHaveProperty("request");
  const wrongKey = createDemo(signing, {
    privateKey: privateKey(3),
    store: new Map([[card.message, card]]),
  });
  await post(wrongKey, "/api/reader/read", { message: card.message });
  const unauthenticated = await post(
    wrongKey,
    "/api/reader/vas",
    envelope(cryptogramHex)
  );
  expect(unauthenticated.status).toBe(400);
  expect(await state(wrongKey)).not.toHaveProperty("request");
});

test("the demo can resolve and revoke a card across durable store reopenings", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "insurance-demo-"));
  const filename = path.join(directory, "cards.sqlite");
  let store = new SqliteCardStore(filename);
  try {
    const issuing = createDemo(undefined, { store });
    const issued = await post(issuing, "/api/issue", dependentSample);
    const result: unknown = await issued.json();
    if (
      result === null ||
      typeof result !== "object" ||
      !("card" in result) ||
      result.card === null ||
      typeof result.card !== "object" ||
      !("message" in result.card)
    ) {
      throw new Error("Missing durable card reference.");
    }
    const read = { message: result.card.message };
    store.close();
    store = new SqliteCardStore(filename);
    const app = createDemo(undefined, { store });
    const resolved = await post(app, "/api/reader/read", read);
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ request, sent: false });
    await post(app, "/api/revoke", read);
    store.close();
    store = new SqliteCardStore(filename);
    const restarted = createDemo(undefined, { store });
    const rejected = await post(restarted, "/api/reader/read", read);
    expect(rejected.status).toBe(400);
    expect(await state(restarted)).not.toHaveProperty("request");
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a linked Wallet badge shows synthetic outcomes, and a failed scan clears the previous result", async () => {
  const app = createDemo(undefined, {
    publicDemo: {
      message: fixture.message,
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: privateKey(1),
    },
  });
  for (const [scenario, status] of [
    ["active", "ACTIVE"],
    ["inactive", "INACTIVE"],
    ["rejected", "UNKNOWN"],
  ]) {
    await post(app, "/api/reader/demo-scenario", { scenario });
    await post(app, "/api/reader/demo-status", { status: "waiting" });
    expect(await state(app)).not.toHaveProperty("readerResult");
    const response = await post(
      app,
      "/api/reader/demo-badge",
      envelope(fixture.cryptograms[0].cryptogramHex)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      eligibility: { status },
      memberName: "JAMIE MORGAN",
      mode: "simulation",
      request,
      sent: false,
    });
  }
  const failed = await post(app, "/api/reader/demo-badge", {
    ...envelope(fixture.cryptograms[0].cryptogramHex),
    passTypeIdentifier: "pass.unlinked.badge",
  });
  expect(failed.status).toBe(400);
  expect(await state(app)).not.toHaveProperty("readerResult");
  expect(await state(app)).not.toHaveProperty("request");
  expect(await state(app)).toMatchObject({ publicDemo: { status: "failed" } });
  const unlinked = createDemo(undefined, {
    publicDemo: {
      message: "another-badge",
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: privateKey(1),
    },
  });
  const unknown = await post(
    unlinked,
    "/api/reader/demo-badge",
    envelope(fixture.cryptograms[0].cryptogramHex)
  );
  expect(unknown.status).toBe(400);
  expect(await state(unlinked)).not.toHaveProperty("readerResult");
  expect(await state(unlinked)).not.toHaveProperty("currentCard");
});

test("personal badge reads preserve the dated saved result and cannot substitute synthetic outcomes", async () => {
  const saved = {
    checkedAt: "2026-10-23T19:00:00Z",
    clinic: clinicSample,
    insurance: dependentSample,
    providerNpi: clinicSample.billingProviderNpi,
    result: {
      benefits: [],
      errors: [],
      plan: { memberId: dependentSample.subscriber.memberId },
      status: "ACTIVE",
    },
  };
  for (const invalid of [
    { ...saved, providerNpi: "1888888880" },
    {
      ...saved,
      result: { ...saved.result, plan: { memberId: "different-member" } },
    },
    { ...saved, checkedAt: "not-a-date" },
  ]) {
    expect(() => parseCachedProfile(invalid)).toThrow();
  }
  const app = createDemo(undefined, {
    publicDemo: {
      message: fixture.message,
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: privateKey(1),
      profile: parseCachedProfile(saved),
    },
  });
  const config = await app.fetch(
    new Request("http://localhost/api/reader/config")
  );
  expect(await config.json()).toMatchObject({
    eligibilityReady: false,
    nfcPassReady: false,
    publicDemo: { dataMode: "personal-cache", ready: true },
    syntheticOnly: false,
  });
  const response = await post(
    app,
    "/api/reader/demo-badge",
    envelope(fixture.cryptograms[0].cryptogramHex)
  );
  expect(await response.json()).toEqual({
    checkedAt: saved.checkedAt,
    eligibility: saved.result,
    memberName: "JAMIE MORGAN",
    mode: "cached",
    request,
    sent: false,
  });
  const synthetic = await post(app, "/api/reader/simulate", {
    scenario: "active",
  });
  expect(synthetic.status).toBe(409);
  const current = z
    .object({ currentCard: z.object({ message: z.string() }) })
    .parse(await state(app));
  await post(app, "/api/revoke", { message: current.currentCard.message });
  const revoked = await post(
    app,
    "/api/reader/demo-badge",
    envelope(fixture.cryptograms[0].cryptogramHex)
  );
  expect(revoked.status).toBe(400);
  expect(await state(app)).not.toHaveProperty("readerResult");
});
