import { expect, test } from "bun:test";

import { generateNfcKeys } from "../src/index";
import { createPartnerPrototype, partnerPrototypes } from "./partners";

test("reusing an NFC issuer configuration cannot enable NFC on a fictional partner prototype", async () => {
  const configuration = {
    demo: false,
    encryptionPublicKey: generateNfcKeys().encryptionPublicKey,
    organizationName: "Existing issuer",
    passTypeIdentifier: "pass.org.openinsurance.test",
    teamIdentifier: "EXAMPLE001",
  };
  const { card, issuer, wallet } = await createPartnerPrototype(
    partnerPrototypes[0],
    configuration,
    true
  );
  const pass = issuer.pass(card.message);
  expect(pass).not.toHaveProperty("nfc");
  expect(wallet).not.toHaveProperty("encryptionPublicKey");
  expect(wallet.demo).toBe(true);
  expect(pass.passTypeIdentifier).toBe(configuration.passTypeIdentifier);
});
