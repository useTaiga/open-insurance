# Open Insurance

An open-source reference implementation for tap-to-enter insurance: issuer-managed Apple Wallet passes, an experimental NFC reader, and insurance fields that map directly to Stedi eligibility requests.

Original code is MIT licensed. This is a developer preview. Apple NFC approval, certified production readers, authenticated clinic access and production eligibility processing are separate deployment requirements. The included lab sends no live inquiries.

## Quick start

Install Bun 1.4.4, then:

```sh
bun install
bun run dev
```

Open http://127.0.0.1:4320. Issue a fictional subscriber or dependent card and simulate its read. The lab shows the exact unsent eligibility request. No account, patient database or vendor API key is required.

Set `INSURANCE_CARD_PORT` to use another local port. The server always binds to loopback.

```sh
bun run test
bun run typecheck
bun run reader:setup
bun run reader test
```

## Issuer integration

```ts
import { InsuranceCardIssuer, createApplePassJson } from "@open-insurance/core";

const issuer = new InsuranceCardIssuer();
const card = issuer.issue(
  {
    tradingPartnerServiceId: "00001",
    tradingPartnerName: "Example Health",
    subscriber: {
      firstName: "CASEY",
      lastName: "MORGAN",
      memberId: "0000123456",
      groupNumber: "000987",
    },
  },
  new Date(Date.now() + 86_400_000)
);

const pass = createApplePassJson(card, {
  organizationName: "Example Health",
  passTypeIdentifier: "pass.example.insurance",
  teamIdentifier: "EXAMPLE001",
});
```

The example is unsigned. Signing requires an Apple-issued certificate and private key. Omitting `encryptionPublicKey` creates an ordinary Wallet pass with NFC disabled. Adding it requires Apple's NFC-authorized signing permission. Never use fictitious issuer metadata to claim a working signed pass.

Issuer JSON can set `branding: {background: "#15463d", foreground: "#ffffff", label: "#bedece"}`. Run `bun run --cwd packages/insurance-card preview --insurance <JSON> --issuer <JSON> --out <new directory>` to render an unissued PNG/SVG concept. Add `--logo <PNG>` to embed a payer image from your authorized branding source. The same issuer colors are used in pass generation. Previews do not enable NFC or send any data.

The issuer maps authoritative enrollment data into `InsuranceData`, distributes its pass through the member portal, and operates a resolver with update/revocation support. Member/group identifiers remain strings. Subscriber/dependent fields use the bundled Stedi legacy eligibility request contract without renaming or coercion. Ship a versioned adapter when changing clearinghouse contracts.

## Clinic integration

```ts
import { createEligibilityRequest } from "@open-insurance/core";

const card = issuer.resolve(decryptedNfcMessage);
const request = createEligibilityRequest(card.insurance, {
  billingProviderNpi: authenticatedClinicNpi,
  provider: { npi: authenticatedClinicNpi, organizationName: clinicName },
  encounter: { serviceTypeCodes: ["30"] },
});
```

Obtain the clinic NPI from an authenticated authorization boundary. NPI equality is not authentication. The credential identifies coverage; retrieve current eligibility for the visit through your authorized clearinghouse integration. The lab intentionally has no paid send endpoint.

## Wallet and NFC lab

The NFC payload is an opaque reference, not member data. `decryptVasData()` handles P-256 ECDH and authenticated VAS decryption. It returns the message and device timestamp; the library does not supply patient authentication, clinic authorization, or a replay policy.

The PN532 adapter is experimental. A successful physical read is not reader certification. See [reader setup and diagnostics](apps/insurance-card-demo/reader/README.md).

```sh
bun run reader doctor
bun run reader vas-probe --timeout 15
```

For a separately linked public NFC test badge, configure an owner-only file outside this repository with `passTypeIdentifier`, `privateKeyFile` and the exact decrypted `message`. Start the lab with `INSURANCE_CARD_PUBLIC_DEMO_FILE` pointing to it and run `bun run reader wallet-demo --timeout 30`. The badge maps to fictional insurance and clearly labeled sample benefits. It does not modify the third-party pass or grant approval to issue your own NFC passes.

An explicitly authorized personal bench test can additionally configure `profileFile` with a matching saved insurance/eligibility result. Saved results retain their original check timestamp. Keep all such profiles outside the checkout. This local mode is not a clinic production service or patient authentication system.

## Signing and persistence

The lab reads `INSURANCE_CARD_ISSUER_FILE`, `INSURANCE_CARD_SIGNER_CERT`, `INSURANCE_CARD_SIGNER_KEY`, and `INSURANCE_CARD_WWDR_CERT`. Keep keys outside the checkout. Issue a fictional card and download the signed Wallet test card. NFC remains permission-gated.

`signApplePass(card, issuer, certificates, assets)` accepts optional `logo`, `logo2x` and `logo3x` PNG buffers for issuer branding. Prepare correctly sized Apple Wallet logo assets before signing; preview images and signer assets are independent inputs.

`InsuranceCardIssuer` defaults to memory. Bun applications can supply `SqliteCardStore` from `@open-insurance/core/sqlite`. `INSURANCE_CARD_STORE_FILE` configures it for the lab. Local SQLite storage is not a production resolver architecture.

## Contract generation

Generated field signatures and validation constraints are included. To regenerate, supply a Stedi healthcare OpenAPI document obtained separately:

```sh
bun run --cwd packages/insurance-card generate:stedi --source /path/to/healthcare.json
```

The generator records the source version and SHA-256. Vendor descriptions and examples are excluded. The normalized eligibility result schema is shared in `@open-insurance/contracts`.

## Deployment boundary

Production operators must provide verified issuance, private key management, authenticated clinic/readers, scope enforcement, revocation, replay handling, access logs and appropriate privacy/security arrangements. A credential reference alone does not authorize disclosure of health information. Do not put patient data, private keys, captures or local profiles into commits or issues.

This project includes no private application code, database client, production credential, insurer endorsement or access to patient records. See [third-party components](THIRD_PARTY.md).
