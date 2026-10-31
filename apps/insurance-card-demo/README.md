# Issuer and clinic lab

Start with `bun run dev` from the project root and open http://127.0.0.1:4320. The lab binds to loopback and sends no live eligibility inquiries. Set `INSURANCE_CARD_PORT` to use another port.

Issue a fictional card with supplied benefits, then simulate a read. This software path needs no account, Apple credentials or hardware. Signing is optional; see [integration](../../docs/integration.md#signing-and-persistence).

## Wallet and NFC lab

The NFC payload is an opaque reference, not member data. `decryptVasData()` handles P-256 ECDH and authenticated VAS decryption. It returns the message and device timestamp; the library does not supply patient authentication, clinic authorization, or a replay policy.

The PN532 adapter is experimental. A successful physical read is not reader certification. See [reader setup and diagnostics](reader/README.md).

```sh
bun run reader doctor
bun run reader vas-probe --timeout 15
```

## Linked Wallet badge

For a separately linked public NFC test badge, configure an owner-only file outside this repository with `passTypeIdentifier`, `privateKeyFile` and the exact decrypted `message`. Start the lab with `INSURANCE_CARD_PUBLIC_DEMO_FILE` pointing to it and run `bun run reader wallet-demo --timeout 30`. The badge maps to fictional insurance and clearly labeled sample benefits. It does not modify the third-party pass or grant approval to issue your own NFC passes.

An explicitly authorized personal bench test can additionally configure `profileFile` with a matching saved insurance/eligibility result. Saved results retain their original check timestamp. Keep all such profiles outside the checkout. This local mode is not a clinic production service or patient authentication system.
