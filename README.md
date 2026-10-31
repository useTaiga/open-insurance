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

Install the source dependency in a Bun application:

```sh
bun add github:useTaiga/open-insurance
```

Pin the reviewed commit in your lockfile. This developer preview ships TypeScript source for Bun; it is not an npm release. The issuer API runs on your server, where Stedi credentials, Apple keys and enrollment records remain private.

```ts
import { createInsurer } from "open-insurance";
import { createStediPayerDirectory } from "open-insurance/stedi";

const insurer = await createInsurer({
  payerId: "22099",
  directory: createStediPayerDirectory({ apiKey: process.env.STEDI_API_KEY! }),
  wallet: {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
    teamIdentifier: process.env.APPLE_TEAM_ID!,
    // Include encryptionPublicKey only with Apple's NFC-enabled permission.
  },
  store: persistentCardStore,
});

// Fictional enrollment data; obtain real values from your member system.
const card = insurer.issue(
  {
    subscriber: {
      firstName: "CASEY",
      lastName: "MORGAN",
      memberId: "0000123456",
      groupNumber: "000987",
    },
  },
  coverageExpiresAt
);
const pkpass = await insurer.sign(card.message, signingCertificates);
// Serve pkpass as application/vnd.apple.pkpass from your member portal.
```

The payer ID selects the exact payer name and optional Stedi logo. Logos fit inside Wallet's image bounds at three resolutions, preserving their proportions without padding. The adapter includes starter palettes: blue for Horizon, purple for Aetna and navy for UnitedHealthcare. Stedi supplies no brand colors; these are SDK defaults. Insurers can override them with `wallet.branding`, and a custom directory may return `branding` with its payer record.

Fuzzy or ambiguous matches fail. Member input cannot change the configured payer. Supplying a payer ID does not verify that you represent that payer. The directory sends no patient data and does not forward credentials to the logo host.

Signing requires an Apple-issued certificate and private key. Omitting `encryptionPublicKey` creates an ordinary Wallet pass with NFC disabled. Adding it requires Apple's NFC-authorized signing permission. `insurer.pass(card.message)` returns unsigned JSON. Refresh long-lived insurer instances at least daily to keep payer metadata current, following [Stedi's directory guidance](https://www.stedi.com/docs/healthcare/api-reference/get-search-payers).

`createInsurer()` composes independent primitives: `InsuranceCardIssuer`, `createApplePassJson()` and `signApplePass()`. Its `directory` accepts your own `PayerDirectory` implementation when your organization maintains its own brand registry. Within this checkout, the SDK workspace is `@open-insurance/core`; consumers installing the GitHub dependency import `open-insurance`.

Issuer JSON can set `branding: {background: "#15463d", foreground: "#ffffff", label: "#bedece"}`. Run `bun run --cwd packages/insurance-card preview --insurance <JSON> --issuer <JSON> --out <new directory>` to render an unissued PNG/SVG concept. Add `--logo <PNG>` to embed a payer image from your authorized branding source. The same issuer colors are used in pass generation. Previews do not enable NFC or send any data.

The issuer maps authoritative enrollment data into `InsuranceData`, distributes its pass through the member portal, and operates a resolver with update/revocation support. Member/group identifiers remain strings. Subscriber/dependent fields use the bundled Stedi legacy eligibility request contract without renaming or coercion. Ship a versioned adapter when changing clearinghouse contracts.

## Benefits without a new check

Attach a complete JSON object from the insurer's member system or an existing Stedi response:

```ts
insurer.setBenefits(card.message, {
  source: "issuer", // "stedi" identifies a saved Stedi response.
  format: "stedi-eligibility-legacy",
  insurance: card.insurance,
  asOf: observedAt.toISOString(),
  expiresAt: benefitsValidUntil.toISOString(),
  data: completeBenefitsJson,
});

const supplied = insurer.benefits(decryptedNfcMessage, authenticatedClinicNpi);
```

The reader can display `supplied.snapshot.data` immediately. Every JSON field is retained, including nested and unknown benefit details. A new Stedi inquiry is optional. Updating benefits changes the server record, so the member does not need a new Wallet card for each update.

Snapshots bind to the exact payer, subscriber and dependent on the card. Set `providerNpi` when a saved response belongs to a specific provider; readers must supply that matching context. The issuer is responsible for attaching the correct response and operating an authenticated resolver. Source and format are supplied metadata, not a verified payer attestation.

The envelope includes its source, UTC `asOf` and expiration. Reads report `within-validity`, `expired` or `not-yet-valid`. These labels describe the supplied window; they do not establish current visit-specific coverage. An expired snapshot stays available as historical information. A caller may explicitly refresh it through the insurer or its clearinghouse.

Only a reference crosses Wallet NFC. The complete JSON is retrieved from the issuer's authorized service. A benefits object is too large for [Wallet's 64-byte NFC message](https://developer.apple.com/documentation/walletpasses/pass/nfc-data.dictionary).

In the lab, leave “Include fictional issuer benefits” checked, issue a card and simulate its read. The supplied-benefits panel shows the complete object, timestamps and export. The optional inquiry remains unsent. No patient data or vendor API key is needed.

## Clinic integration

```ts
import { createEligibilityRequest } from "open-insurance";

const card = insurer.resolve(decryptedNfcMessage);
const request = createEligibilityRequest(card.insurance, {
  billingProviderNpi: authenticatedClinicNpi,
  provider: { npi: authenticatedClinicNpi, organizationName: clinicName },
  encounter: { serviceTypeCodes: ["30"] },
});
```

Obtain the clinic NPI from an authenticated authorization boundary. NPI equality is not authentication. The credential identifies coverage. Read supplied benefits when available; request a fresh visit-specific response through an authorized issuer or clearinghouse integration when needed. The lab intentionally has no paid send endpoint.

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

`InsuranceCardIssuer` defaults to memory. Bun applications can supply `SqliteCardStore` from `open-insurance/sqlite`. `INSURANCE_CARD_STORE_FILE` configures it for the lab. Local SQLite storage is not a production resolver architecture.

## Contract generation

Generated field signatures and validation constraints are included. To regenerate, supply a Stedi healthcare OpenAPI document obtained separately:

```sh
bun run --cwd packages/insurance-card generate:stedi --source /path/to/healthcare.json
```

The generator records the source version and SHA-256. Vendor descriptions and examples are excluded. The normalized eligibility result schema is shared in `@open-insurance/contracts`.

## Deployment boundary

Production operators must provide verified issuance, private key management, authenticated clinic/readers, scope enforcement, revocation, replay handling, access logs and appropriate privacy/security arrangements. A credential reference alone does not authorize disclosure of health information. Do not put patient data, private keys, captures or local profiles into commits or issues.

This project includes no private application code, database client, production credential, insurer endorsement or access to patient records. See [third-party components](THIRD_PARTY.md).
