# Integration

For a runnable portal and resolver with enrollment/session adapters and signing diagnostics, start with [issuer onboarding](issuer-onboarding.md). The primitives below remain available independently.

See [architecture](architecture.md) for ownership, reader trust and deployment boundaries. Run all commands from the repository root.

## Issuer configuration

Install the source dependency in a Bun application:

```sh
bun add github:useTaiga/open-insurance
```

Pin the reviewed commit in your lockfile. This developer preview ships TypeScript source for Bun; it is not an npm release. The issuer API runs on your server, where Stedi credentials, Apple keys and enrollment records remain private. For a complete offline example with defined inputs, run `bun run example` or read [the issuer example](../packages/insurance-card/examples/issuer.ts). The factory below accepts application-owned credentials, Wallet settings and storage; it does not issue a card when imported.

```ts
import { createInsurer } from "open-insurance";
import type { CardStore, InsurerOptions } from "open-insurance";
import { createStediPayerDirectory } from "open-insurance/stedi";

export const createPayerIssuer = (
  payerId: string,
  apiKey: string,
  wallet: InsurerOptions["wallet"],
  store: CardStore
) =>
  createInsurer({
    payerId,
    directory: createStediPayerDirectory({ apiKey }),
    wallet,
    store,
  });
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
