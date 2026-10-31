# Architecture

Open Insurance separates the issuer's member record, the Wallet credential and the clinic's intake workflow.

```mermaid
flowchart LR
  Enrollment[Issuer member system] --> Issuer[Issuer SDK and card store]
  Issuer --> Wallet[Signed Wallet pass]
  Wallet -->|NFC reference| Reader[Configured VAS reader]
  Reader --> Resolver[Authenticated issuer resolver]
  Resolver --> Intake[Clinic intake]
  Intake -. optional fresh inquiry .-> Eligibility[Issuer or clearinghouse]
```

The SDK and experimental reader supply building blocks for this flow. The diagram's authenticated resolver and clinic intake are deployment responsibilities; the loopback lab is not their production implementation.

## Card reference

The NFC message is `ic1_` plus 32 base64url characters: a 36-byte reference with 192 bits of randomness. It contains no patient or benefit data. [Wallet NFC](https://developer.apple.com/documentation/walletpasses/pass/nfc-data.dictionary) permits at most 64 bytes, so the reader uses the reference to retrieve larger records from the issuer.

The presenting pass needs an NFC-enabled signing identity. The reader needs the configured pass identifier and VAS decryption configuration. There is no global issuer discovery directory in this project. A successful simulated read or ordinary Wallet installation does not demonstrate NFC transfer.

## Issuer record

An issued record contains the reference, credential expiration, insurance and optional benefits snapshot. Subscriber and dependent fields follow the bundled Stedi legacy request schema. Member IDs and group numbers stay strings, including leading zeros.

`InsuranceCardIssuer` defaults to memory. The optional Bun SQLite adapter persists records locally. Production storage, tenant authorization and data lifecycle controls belong to the issuer's implementation.

`revoke()` invalidates resolution of a reference. It does not remove a pass from a member's Wallet. Updating stored benefits changes subsequent lookups without changing the Wallet reference. Wallet push updates and a pass-update web service are not included.

## Benefits and provenance

Snapshots preserve the entire supplied JSON object and bind to the card's exact payer, subscriber and dependent data. Their source, format, `asOf` and expiration are supplied metadata. The SDK does not independently attest that a payer produced the object.

Validity labels describe the supplied time window at read time. They do not establish current coverage for a particular provider, service or visit. Provider-specific snapshots require a matching provider context. A fresh inquiry is an explicit integration decision.

## Clinic boundary

Resolve insurance only after authorizing the requesting clinic. Obtain its billing-provider NPI from that authenticated scope and verify it at the resource boundary. Comparing two NPI strings is not authentication.

The library composes an eligibility request but sends none. Patient matching, EHR persistence and payment collection are separate integrations. Eligibility and saved benefits are not instructions to charge a patient.

## Keys and reader trust

Apple's pass-signing identity and the VAS encryption pair serve different purposes. Keep private keys on the issuer backend or an explicitly authorized reader. The SDK verifies cryptographic VAS authentication; it does not supply a deployment's freshness/replay policy or clinic authorization.

The PN532 implementation follows public protocol research and is experimental. Production deployment requires appropriate [Apple pass, reader and software support](https://developer.apple.com/wallet/loyalty-passes/). A bench read is not reader certification.
