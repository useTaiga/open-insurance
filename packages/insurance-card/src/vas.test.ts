import { expect, test } from "bun:test";
import { createECDH, createPrivateKey } from "node:crypto";

import fixture from "./fixtures/vas.json";
import { decryptVasData, parseVasReadInput } from "./vas";

const testKey = (scalar: number): string => {
  const privateBytes = Buffer.alloc(32);
  privateBytes[31] = scalar;
  const curve = createECDH("prime256v1");
  curve.setPrivateKey(privateBytes);
  const publicBytes = curve.getPublicKey();
  return createPrivateKey({
    format: "jwk",
    key: {
      crv: "P-256",
      d: privateBytes.toString("base64url"),
      kty: "EC",
      x: publicBytes.subarray(1, 33).toString("base64url"),
      y: publicBytes.subarray(33, 65).toString("base64url"),
    },
  }).export({ format: "pem", type: "pkcs8" });
};

test.each(fixture.cryptograms)(
  "decrypts an independently generated VAS method $method fixture",
  ({ cryptogramHex }) => {
    const input = parseVasReadInput({
      mobileTokenBase64: "",
      passTypeIdentifier: fixture.passTypeIdentifier,
      vasDataBase64: Buffer.from(cryptogramHex, "hex").toString("base64"),
    });
    expect(
      decryptVasData({
        passTypeIdentifier: input.passTypeIdentifier,
        privateKey: testKey(1),
        vasData: Buffer.from(input.vasDataBase64, "base64"),
      })
    ).toEqual({
      message: fixture.message,
      timestamp: "2026-10-31T19:00:00.000Z",
    });
  }
);

test("altered VAS data, a different reader key, and the wrong pass type cannot resolve a credential", () => {
  const vasData = Buffer.from(fixture.cryptograms[0].cryptogramHex, "hex");
  const altered = Buffer.from(vasData);
  altered[altered.length - 1] = ((altered.at(-1) ?? 0) + 1) % 256;
  for (const input of [
    {
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: testKey(1),
      vasData: altered,
    },
    {
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: testKey(3),
      vasData,
    },
    {
      passTypeIdentifier: "pass.wrong.issuer",
      privateKey: testKey(1),
      vasData,
    },
    {
      passTypeIdentifier: fixture.passTypeIdentifier,
      privateKey: testKey(1),
      vasData: vasData.subarray(0, 55),
    },
  ]) {
    expect(() => decryptVasData(input)).toThrow();
  }
  expect(() =>
    parseVasReadInput({
      mobileTokenBase64: "",
      passTypeIdentifier: fixture.passTypeIdentifier,
      vasDataBase64: "!".repeat(100),
    })
  ).toThrow();
});
