# Issuer onboarding

Generate a working reference integration for Angle Health, Curative or Oscar Health. All three use the same enrollment, signing and clinic APIs. The presets contain illustrative payer routing and branding, not a verified partnership or a complete routing directory.

From the repository root:

```sh
bun run onboarding init --payer angle --out /tmp/angle-insurance
cd /tmp/angle-insurance
bun install
bun run doctor
bun run dev
```

Open http://127.0.0.1:4320. Choose a fictional policyholder or dependent, preview the card and simulate a clinic read. Supplied benefits retain their complete JSON and dates. The optional eligibility request remains unsent. Use `--payer curative` or `--payer oscar` for the other presets, or `PORT=4321 bun run dev` when the lab is already using port 4320.

The generated dependency comes from GitHub. Commit the reviewed revision in your application's lockfile. This source preview requires Bun; it is not a published npm package. To test an unpublished local export, pass `--sdk file:/absolute/path/to/open-insurance` to `init`. The project refuses an existing output directory, writes keys with owner-only permissions and ignores its local configuration, enrollment, database and key files in Git.

## Replace three adapters

The generated README explains each handoff in detail:

| Adapter | Issuer supplies |
| --- | --- |
| `createEnrollmentLoader()` | Authoritative enrollment keyed by an internal member identifier. Map policyholder and dependent separately; preserve member/group IDs as strings. Supply benefits with their original observation and expiration times. |
| `authorizeMember(request)` | The member's existing authenticated portal session mapped to that internal identifier. |
| `authorizeClinic(request, memberKey)` | An authenticated clinic authorized to access that member, with its verified billing NPI and provider context. |

The default server binds to loopback and uses fictional selectors for its two identities and clinic. These selectors are not authentication. The separate [pilot mode](pilot.md) verifies signed identity tokens and member-specific clinic grants. Connect it to the issuer's actual identity and enrollment systems before using real data.

The SDK entry point is `createIssuerIntegration` from `open-insurance/integration`. It accepts the three callbacks plus issuer setup, `CardStore` and `MemberIndex`. `SqliteCardStore` and `SqliteMemberIndex` are available from `open-insurance/sqlite`. They support a local reference deployment; production storage and operational policy belong to the host application.

## Setup checker

The default project requests NFC and generates a P-256 encryption pair. It includes no Apple signing identity. The first `doctor` run exits with status 1 and reports signing blocked; the software preview still works. It does not submit an Apple permission request.

Edit `issuer.json` with your Apple-issued pass/team identifiers and paths to the signer certificate, signer private key and WWDR intermediate. Keep private keys outside the checkout. `passphraseEnvironment` optionally names the environment variable containing the signing-key passphrase. Paths resolve relative to this configuration file.

```sh
# Also usable against an existing integration's config:
bun run onboarding doctor --config /private/path/issuer.json --json
```

| Diagnostic | What it establishes |
| --- | --- |
| Wallet signing | Readable files, valid certificate dates, matching certificate UID/team, matching signing key, pass capability and a signature chain through the configured intermediate to a bundled Apple root. |
| NFC configuration | All Wallet checks, Apple's enhanced NFC pass extension and a matching P-256 reader encryption key pair. |
| Physical tap | Always unverified by this offline checker. Install the pass and demonstrate a real encrypted read on the intended reader. |

An ordinary pass certificate cannot satisfy NFC readiness. A self-signed certificate with the same extension cannot satisfy Apple trust. The offline checker does not check revocation, certify a reader, verify a commercial agreement or claim production readiness. Its Apple root certificates come from [Apple PKI](https://www.apple.com/certificateauthority/). The enhanced pass extension is documented in Apple's [WWDR Certification Practice Statement](https://images.apple.com/certificateauthority/pdf/Apple_WWDR_CPS_v1.32.pdf).

For an explicit ordinary Wallet test, generate with `--wallet-only`, or remove `wallet.encryptionPublicKey` from the generated configuration. This does not enable tap. A project requesting NFC never silently falls back to ordinary signing. Restart the server after rotating credentials or changing setup, and monitor certificate validity in a deployed application.

Apple permission belongs to the issuing identity. A service provider's own approval does not automatically authorize every insurer's cards. See Apple's [Wallet requirements](https://developer.apple.com/wallet/loyalty-passes/) and [developer agreement](https://developer.apple.com/support/terms/apple-developer-program-license-agreement/).

## Member portal and reader API

Add a normal authenticated portal link to `GET /member/pass.pkpass`. `GET /member/pass.json` provides an unsigned developer preview. `DELETE /member/card` revokes that member's current reference. Host applications must apply their usual session and CSRF controls.

Repeated downloads preserve the reference while the stored credential is current. Enrollment requires explicit `status` and `credentialExpiresAt`; see [coverage and updates](intake.md). Reads refresh authoritative enrollment and supplied benefits; omitting benefits clears the previous snapshot. `integration.sync(memberKey)` connects verified issuer enrollment events and invalidates terminated records. `integration.revoke(memberKey)` invalidates a credential. These operations do not terminate an insurance policy. Wallet push updates are not included.

The clinic reader posts an encrypted VAS envelope to `POST /clinic/vas`, with its authenticated clinic credentials. The shape is `passTypeIdentifier`, `vasDataBase64` and `mobileTokenBase64`, matching `VasReadInput`. The configured pass identity, trusted NFC signer and matching reader key are required. Authorization must also grant this clinic access to the resolved member. The Python reader's [issuer mode](pilot.md#connect-the-member-portal-and-reader) uses this endpoint; existing lab commands remain separate.

`POST /clinic/read` accepts `{ "message": "ic1_..." }` for an authenticated host integration or simulation. It is not proof of a new physical tap. Both read endpoints return insurance, supplied benefits or `null`, their validity window, and a prepared eligibility request with `sent: false`. Provider-specific benefits are withheld from other billing providers. A fresh payer inquiry is an explicit downstream choice, not a charge triggered by downloading a card.

Only the opaque reference crosses NFC. The server retrieves the complete benefits JSON. Neither source labels nor validity windows independently attest current coverage. Deployment must define reader authentication, consent, timestamp/replay policy, patient matching, audit, HTTPS, key lifecycle, monitoring and storage before real intake. The PN532 remains experimental.

## Measure the integration

Track engineering time to first validated enrollment, first signed Wallet download and first real encrypted NFC handoff. Record Apple's approval waiting time separately. Use a scoped, issuer-authorized pilot to prove clinic workflow and integration effort before broader member distribution.
