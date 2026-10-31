import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  ECDH,
} from "node:crypto";

import Ajv from "ajv";

export interface VasReadInput {
  passTypeIdentifier: string;
  vasDataBase64: string;
  mobileTokenBase64: string;
}

const validateRead = new Ajv().compile<VasReadInput>({
  additionalProperties: false,
  properties: {
    mobileTokenBase64: { maxLength: 44, type: "string" },
    passTypeIdentifier: { maxLength: 255, pattern: "^pass\\.", type: "string" },
    vasDataBase64: { maxLength: 160, minLength: 76, type: "string" },
  },
  required: ["passTypeIdentifier", "vasDataBase64", "mobileTokenBase64"],
  type: "object",
});

export const parseVasReadInput = (value: unknown): VasReadInput => {
  if (!validateRead(value)) {
    throw new Error("Invalid Apple VAS reader envelope.");
  }
  for (const encoded of [value.vasDataBase64, value.mobileTokenBase64]) {
    if (Buffer.from(encoded, "base64").toString("base64") !== encoded) {
      throw new Error("VAS reader data must use canonical Base64.");
    }
  }
  return value;
};

export interface DecryptedVasData {
  message: string;
  timestamp: string;
}

export const decryptVasData = ({
  passTypeIdentifier,
  privateKey,
  vasData,
}: {
  passTypeIdentifier: string;
  privateKey: Buffer | string;
  vasData: Uint8Array;
}): DecryptedVasData => {
  const payload = Buffer.from(vasData);
  if (payload.length < 56 || payload.length > 120) {
    throw new Error("Invalid Apple VAS cryptogram length.");
  }
  const readerKey = createPrivateKey(privateKey);
  if (readerKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new Error("VAS decryption requires a P-256 private key.");
  }
  const readerPublic = createPublicKey(readerKey).export({ format: "jwk" });
  if (readerPublic.x === undefined) {
    throw new Error("Missing VAS reader public key.");
  }
  const keyId = createHash("sha256")
    .update(Buffer.from(readerPublic.x, "base64url"))
    .digest()
    .subarray(0, 4);
  if (!keyId.equals(payload.subarray(0, 4))) {
    throw new Error("VAS cryptogram does not match this reader key.");
  }
  const point = ECDH.convertKey(
    Buffer.concat([Buffer.from([2]), payload.subarray(4, 36)]),
    "prime256v1"
  );
  if (!Buffer.isBuffer(point)) {
    throw new TypeError("Invalid VAS device public key.");
  }
  const deviceKey = createPublicKey({
    format: "jwk",
    key: {
      crv: "P-256",
      kty: "EC",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
  });
  const shared = diffieHellman({ privateKey: readerKey, publicKey: deviceKey });
  const passHash = createHash("sha256").update(passTypeIdentifier).digest();
  const label = Buffer.from("ApplePay encrypted VAS data");
  const methods = [
    {
      aad: Buffer.alloc(0),
      info: Buffer.concat([
        Buffer.from([13]),
        Buffer.from("id-aes256-GCM"),
        label,
        passHash,
      ]),
    },
    { aad: passHash, info: label },
  ];
  for (const method of methods) {
    const key = createHash("sha256")
      .update(shared)
      .update(Buffer.from([0, 0, 0, 1]))
      .update(method.info)
      .digest();
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.alloc(16));
      decipher.setAAD(method.aad);
      decipher.setAuthTag(payload.subarray(-16));
      plaintext = Buffer.concat([
        decipher.update(payload.subarray(36, -16)),
        decipher.final(),
      ]);
    } catch {
      continue;
    }
    if (plaintext.length < 4 || plaintext.length > 68) {
      throw new Error("Invalid decrypted VAS payload length.");
    }
    return {
      message: new TextDecoder("utf-8", { fatal: true }).decode(
        plaintext.subarray(4)
      ),
      timestamp: new Date(
        Date.UTC(2001, 0, 1) + plaintext.readUInt32BE(0) * 1000
      ).toISOString(),
    };
  }
  throw new Error("VAS cryptogram authentication failed.");
};
