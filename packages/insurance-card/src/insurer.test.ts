import { afterEach, expect, spyOn, test } from "bun:test";

import sharp from "sharp";

import {
  createEligibilityRequest,
  createInsurer,
  generateNfcKeys,
} from "./index";
import type { IssuedCard } from "./issuer";
import { clinicSample, dependentSample } from "./samples";
import { createStediPayerDirectory } from "./stedi";

const wallet = {
  passTypeIdentifier: "pass.example.insurance",
  teamIdentifier: "EXAMPLE001",
};
const member = {
  dependents: dependentSample.dependents,
  subscriber: dependentSample.subscriber,
};
const expiresAt = () => new Date(Date.now() + 60_000);
const directory = async (payerId: string) => ({
  name: `Payer ${payerId}`,
  payerId,
});
const caught = (error: unknown) => error;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : undefined;
let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => {
  fetchMock?.mockRestore();
});

test("a payer-bound card preserves dependent eligibility data and resolves its NFC reference", async () => {
  const logo = await sharp({
    create: {
      background: "#0055aa",
      channels: 4,
      height: 100,
      width: 100,
    },
  })
    .png()
    .toBuffer();
  const issuer = await createInsurer({
    directory: async (payerId) => ({ logo, name: "Example Health", payerId }),
    payerId: "00001",
    wallet: {
      ...wallet,
      encryptionPublicKey: generateNfcKeys().encryptionPublicKey,
    },
  });
  const card = issuer.issue(member, expiresAt());
  const pass = issuer.pass(card.message);
  expect(pass.organizationName).toBe("Example Health");
  expect(pass.generic?.primaryFields?.[0]?.value).toBe("JAMIE MORGAN");
  expect(
    createEligibilityRequest(
      issuer.resolve(pass.nfc?.message).insurance,
      clinicSample
    )
  ).toEqual({
    ...member,
    encounter: clinicSample.encounter,
    provider: clinicSample.provider,
    tradingPartnerName: "Example Health",
    tradingPartnerServiceId: "00001",
  });
  issuer.revoke(card.message);
  expect(() => issuer.pass(card.message)).toThrow("revoked");
});

test("shared storage cannot resolve, sign, revoke or rebrand another payer's card", async () => {
  const store = new Map<string, IssuedCard>();
  const first = await createInsurer({
    directory,
    payerId: "00001",
    store,
    wallet,
  });
  const second = await createInsurer({
    directory,
    payerId: "00002",
    store,
    wallet,
  });
  const card = first.issue(member, expiresAt());
  for (const operation of [second.resolve, second.pass, second.revoke]) {
    expect(() => operation(card.message)).toThrow("another payer");
  }
  expect(
    await second
      .sign(card.message, {
        signerCert: Buffer.alloc(0),
        signerKey: Buffer.alloc(0),
        wwdr: Buffer.alloc(0),
      })
      .catch(errorMessage)
  ).toContain("another payer");
  expect(() =>
    first.issue(
      { ...member, tradingPartnerServiceId: "00002" } as typeof member,
      expiresAt()
    )
  ).toThrow("override");
  expect(first.resolve(card.message).insurance.tradingPartnerServiceId).toBe(
    "00001"
  );
  expect(
    await createInsurer({
      directory: async () => ({ name: "Wrong", payerId: "00002" }),
      payerId: "00001",
      wallet,
    }).catch(errorMessage)
  ).toContain("exact");
});

const payer = {
  avatarUrl: "https://logos.example/insurance.png",
  displayName: "Example Health",
  primaryPayerId: "00001",
  stediId: "ABCDE",
};
test("the Stedi adapter follows pages, rejects fuzzy candidates and downloads branding without credentials", async () => {
  const logo = Buffer.from("logo fixture");
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.hostname === "logos.example") {
          if (init?.headers !== undefined) {
            throw new Error(
              "Directory credentials must not reach the logo host."
            );
          }
          return new Response(logo);
        }
        return Response.json(
          url.searchParams.has("pageToken")
            ? {
                items: [{ payer }],
              }
            : {
                items: [
                  {
                    payer: {
                      ...payer,
                      primaryPayerId: "00001OTHER",
                      stediId: "OTHER",
                    },
                  },
                ],
                nextPageToken: "page-2",
              }
        );
      },
      { preconnect: fetch.preconnect }
    )
  );
  const stediDirectory = createStediPayerDirectory({ apiKey: "synthetic-key" });
  expect(await stediDirectory("00001")).toEqual({
    logo,
    name: payer.displayName,
    payerId: "00001",
    stediId: "ABCDE",
  });
});

test.each([
  [
    "fuzzy-only",
    { items: [{ payer: { ...payer, primaryPayerId: "00001OTHER" } }] },
  ],
  [
    "ambiguous",
    { items: [{ payer }, { payer: { ...payer, stediId: "OTHER" } }] },
  ],
  ["malformed", { items: [{ payer: { ...payer, primaryPayerId: 1 } }] }],
] as const)("Stedi %s results cannot select a payer", async (_name, result) => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(result)
  );
  expect(
    await createStediPayerDirectory({ apiKey: "synthetic-key" })("00001").catch(
      caught
    )
  ).toBeInstanceOf(Error);
});
