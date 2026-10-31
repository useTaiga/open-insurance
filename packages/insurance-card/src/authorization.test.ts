import { expect, test } from "bun:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { createJwtAuthorization } from "./authorization";
import { clinicSample } from "./samples";

const request = (value?: string) =>
  new Request("https://example.test", {
    headers: value === undefined ? {} : { authorization: `Bearer ${value}` },
  });

test("verified identities require correct purpose, current signatures and a member-specific server-side clinic grant", async () => {
  const pair = await generateKeyPair("ES256");
  const issuer = "https://identity.example.test";
  const authority = {
    issuer,
    key: createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] }),
  };
  const authorization = createJwtAuthorization({
    clinic: { ...authority, audience: "clinic-intake" },
    loadClinicGrant: async (subject, memberKey) =>
      subject === "clinic-1" && memberKey === "member-1"
        ? clinicSample
        : undefined,
    loadMemberKey: async (subject) =>
      subject === "person-1" ? "member-1" : undefined,
    member: { ...authority, audience: "member-wallet" },
  });
  const token = async (subject: string, audience: string, expires = "5m") =>
    await new SignJWT({ billingProviderNpi: "1124072285" })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(pair.privateKey);
  const member = await token("person-1", "member-wallet");
  const clinic = await token("clinic-1", "clinic-intake");
  expect(await authorization.authorizeMember(request(member))).toBe("member-1");
  expect(
    await authorization.authorizeClinic(request(clinic), "member-1")
  ).toEqual(clinicSample);
  expect(
    await authorization.authorizeClinic(request(clinic), "member-2")
  ).toBeUndefined();
  expect(
    await authorization.authorizeClinic(request(member), "member-1")
  ).toBeUndefined();
  expect(await authorization.authorizeMember(request(clinic))).toBeUndefined();
  const expired = await token("person-1", "member-wallet", "-1s");
  for (const invalid of [
    undefined,
    "not-a-token",
    expired,
    `${member.slice(0, -8)}tampered`,
  ]) {
    expect(
      await authorization.authorizeMember(request(invalid))
    ).toBeUndefined();
  }
  const noExpiry = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer(issuer)
    .setAudience("member-wallet")
    .setSubject("person-1")
    .setIssuedAt()
    .sign(pair.privateKey);
  expect(
    await authorization.authorizeMember(request(noExpiry))
  ).toBeUndefined();
});
