import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { z } from "zod";

import { createJwtAuthorization } from "./authorization";
import { createIssuerIntegration, parseEnrollment } from "./integration";
import type {
  ActiveEnrollment,
  Enrollment,
  IssuerIntegrationOptions,
} from "./integration";
import { benefitsDataSample, clinicSample, dependentSample } from "./samples";
import { SqliteCardStore, SqliteMemberIndex } from "./sqlite";

const setup = {
  name: "Angle Health",
  payerId: "39856",
  wallet: {
    demo: true,
    organizationName: "Angle Health",
    passTypeIdentifier: "pass.example.insurance",
    teamIdentifier: "EXAMPLE123",
  },
};
const insurance = {
  ...dependentSample,
  tradingPartnerName: setup.name,
  tradingPartnerServiceId: setup.payerId,
};
const snapshot = {
  asOf: "2020-01-01T00:00:00Z",
  data: benefitsDataSample,
  expiresAt: "2020-01-02T00:00:00Z",
  format: "stedi-eligibility-legacy",
  insurance,
  source: "issuer",
};
const enrollment = (): ActiveEnrollment => ({
  benefits: snapshot,
  credentialExpiresAt: new Date(Date.now() + 86_400_000),
  member: {
    dependents: insurance.dependents,
    subscriber: insurance.subscriber,
  },
  status: "active",
});
const request = (route: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${route}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(auth === undefined ? {} : { authorization: auth }),
      "content-type": "application/json",
    },
    method: body === undefined ? "GET" : "POST",
  });
type App = Awaited<ReturnType<typeof createIssuerIntegration>>;
const download = async (app: App) => {
  const response = await app.fetch(
    request("/member/pass.json", undefined, "member")
  );
  expect(response.status).toBe(200);
  const json: unknown = await response.json();
  const { serialNumber } = z.object({ serialNumber: z.string() }).parse(json);
  return { json, message: serialNumber };
};
const inquire = async (app: App, message: string, auth?: string) => {
  const response = await app.fetch(request("/clinic/read", { message }, auth));
  const json: unknown = await response.json();
  return { json, status: response.status };
};
const fixture = async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "insurance-integration-")
  );
  const filename = path.join(directory, "cards.sqlite");
  let cards = new SqliteCardStore(filename);
  let members = new SqliteMemberIndex(filename);
  let current: Enrollment | undefined = enrollment();
  let loads = 0;
  const options = (): IssuerIntegrationOptions => ({
    authorizeClinic: async (req, key) =>
      key === "internal-member-1" &&
      req.headers.get("authorization") === "clinic"
        ? clinicSample
        : undefined,
    authorizeMember: async (req) =>
      req.headers.get("authorization") === "member"
        ? "internal-member-1"
        : undefined,
    cards,
    directory,
    loadEnrollment: async () => {
      loads += 1;
      return structuredClone(current);
    },
    members,
    setup,
  });
  return {
    get cards() {
      return cards;
    },
    close: async () => {
      cards.close();
      members.close();
      await rm(directory, { force: true, recursive: true });
    },
    create: async () => await createIssuerIntegration(options()),
    get loads() {
      return loads;
    },
    get members() {
      return members;
    },
    options,
    restart: () => {
      cards.close();
      members.close();
      cards = new SqliteCardStore(filename);
      members = new SqliteMemberIndex(filename);
    },
    set: (value: Enrollment | undefined) => {
      current = value;
    },
  };
};

test.each(["subscriber", "dependent"] as const)(
  "authenticated %s download and clinic read preserve enrollment and complete benefits across restarts",
  async (patient) => {
    const f = await fixture();
    try {
      let expectedInsurance = insurance;
      if (patient === "subscriber") {
        expectedInsurance = { ...insurance };
        delete expectedInsurance.dependents;
        f.set({
          ...enrollment(),
          benefits: { ...snapshot, insurance: expectedInsurance },
          member: { dependents: undefined, subscriber: insurance.subscriber },
        });
      }
      let app = await f.create();
      const unauthorized = await app.fetch(request("/member/pass.json"));
      expect(unauthorized.status).toBe(401);
      expect(f.loads).toBe(0);
      const pass = await download(app);
      expect(pass.json).toMatchObject({
        generic: {
          primaryFields: [
            {
              value: patient === "dependent" ? "JAMIE MORGAN" : "CASEY MORGAN",
            },
          ],
        },
      });
      const denied = await inquire(app, pass.message);
      expect(denied.status).toBe(403);
      expect(f.loads).toBe(1);
      f.restart();
      app = await f.create();
      const again = await download(app);
      expect(again.message).toBe(pass.message);
      const result = await inquire(app, pass.message, "clinic");
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({
        benefits: {
          freshness: "expired",
          snapshot: { ...snapshot, insurance: expectedInsurance },
        },
        eligibilityRequest: {
          ...(expectedInsurance.dependents === undefined
            ? {}
            : { dependents: expectedInsurance.dependents }),
          provider: clinicSample.provider,
          subscriber: insurance.subscriber,
        },
        insurance: expectedInsurance,
        sent: false,
      });
      const signing = await app.fetch(
        request("/member/pass.pkpass", undefined, "member")
      );
      expect(signing.status).toBe(503);
      expect(signing.headers.get("cache-control")).toBe("no-store");
      const vas = await app.fetch(request("/clinic/vas", {}));
      expect(vas.status).toBe(503);
    } finally {
      await f.close();
    }
  }
);

test("authoritative changes clear old benefits; termination and revocation invalidate references", async () => {
  const f = await fixture();
  try {
    const app = await f.create();
    const pass = await download(app);
    const changed = enrollment();
    changed.member.subscriber = {
      ...changed.member.subscriber,
      groupNumber: "000002",
    };
    changed.benefits = undefined;
    f.set(changed);
    expect(await app.sync("internal-member-1")).toEqual({ status: "updated" });
    const result = await inquire(app, pass.message, "clinic");
    expect(result.json).toMatchObject({
      benefits: null,
      insurance: { subscriber: { groupNumber: "000002" } },
    });
    app.revoke("internal-member-1");
    const revoked = await inquire(app, pass.message, "clinic");
    expect(revoked.status).toBe(404);
    const replacement = await download(app);
    expect(replacement.message).not.toBe(pass.message);
    f.set(
      parseEnrollment(
        { benefits: { outdated: true }, status: "terminated" },
        setup
      )
    );
    expect(await app.sync("internal-member-1")).toEqual({ status: "revoked" });
    const terminated = await inquire(app, replacement.message, "clinic");
    expect(terminated.status).toBe(404);
    const cannotReissue = await app.fetch(
      request("/member/pass.json", undefined, "member")
    );
    expect(cannotReissue.status).toBe(410);
    f.restart();
    const restarted = await f.create();
    const missing = await inquire(restarted, replacement.message, "clinic");
    expect(missing.status).toBe(404);
  } finally {
    await f.close();
  }
});

test("provider scope and payer boundaries fail closed without overwriting another payer's card", async () => {
  const f = await fixture();
  try {
    f.set({
      ...enrollment(),
      benefits: { ...snapshot, providerNpi: "1124072285" },
    });
    let app = await f.create();
    const pass = await download(app);
    const result = await inquire(app, pass.message, "clinic");
    expect(result.json).toMatchObject({
      benefits: null,
      eligibilityRequest: { provider: clinicSample.provider },
    });
    app = await createIssuerIntegration({
      ...f.options(),
      authorizeClinic: async () => ({
        ...clinicSample,
        provider: { npi: "1124072285" },
      }),
    });
    const mismatched = await inquire(app, pass.message, "clinic");
    expect(mismatched.status).toBe(400);
    const existing = f.cards.get(pass.message);
    if (existing === undefined) {
      throw new Error("Expected persisted card.");
    }
    const foreign = {
      ...existing,
      benefits: undefined,
      insurance: dependentSample,
    };
    f.cards.set(pass.message, foreign);
    const crossPayer = await app.fetch(
      request("/member/pass.json", undefined, "member")
    );
    expect(crossPayer.status).toBe(403);
    expect(() => {
      app.revoke("internal-member-1");
    }).toThrow("payer");
    expect(f.cards.get(pass.message)).toEqual(foreign);
    expect(f.members.member("OSCAR", pass.message)).toBeUndefined();
  } finally {
    await f.close();
  }
});

test("pilot HTTP access uses verified token identities and member-specific clinic grants without accepting demo selectors", async () => {
  const f = await fixture();
  try {
    const pair = await generateKeyPair("ES256");
    const authority = {
      issuer: "https://identity.example.test",
      key: createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] }),
    };
    const authorization = createJwtAuthorization({
      clinic: { ...authority, audience: "clinic" },
      loadClinicGrant: async (subject, key) =>
        subject === "clinic-subject" && key === "internal-member-1"
          ? clinicSample
          : undefined,
      loadMemberKey: async (subject) =>
        subject === "member-subject" ? "internal-member-1" : undefined,
      member: { ...authority, audience: "member" },
    });
    const sign = async (subject: string, audience: string) =>
      await new SignJWT({})
        .setProtectedHeader({ alg: "ES256" })
        .setIssuer(authority.issuer)
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(pair.privateKey);
    const app = await createIssuerIntegration({
      ...f.options(),
      ...authorization,
    });
    const demo = await app.fetch(
      new Request("http://localhost/member/pass.json", {
        headers: { cookie: "demo-member=subscriber" },
      })
    );
    expect(demo.status).toBe(401);
    const memberToken = await sign("member-subject", "member");
    const member = await app.fetch(
      request("/member/pass.json", undefined, `Bearer ${memberToken}`)
    );
    expect(member.status).toBe(200);
    const body: unknown = await member.json();
    const { serialNumber } = z.object({ serialNumber: z.string() }).parse(body);
    const wrongAudience = await inquire(
      app,
      serialNumber,
      `Bearer ${memberToken}`
    );
    expect(wrongAudience.status).toBe(403);
    const clinicToken = await sign("clinic-subject", "clinic");
    const result = await inquire(app, serialNumber, `Bearer ${clinicToken}`);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({
      eligibilityRequest: { provider: clinicSample.provider },
      intake: { patient: "dependent", shape: "legacy" },
      sent: false,
    });
    const foreignClinic = await sign("another-clinic", "clinic");
    const denied = await inquire(app, serialNumber, `Bearer ${foreignClinic}`);
    expect(denied.status).toBe(403);
  } finally {
    await f.close();
  }
});
