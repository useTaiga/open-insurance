# Authenticated pilot integration

This workflow prepares a reference API for an issuer-authorized pilot. It does not provision an identity provider, establish an insurer relationship, deploy a service or grant Apple permission. Complete issuer enrollment, identity and clinic access mappings before using real records.

## Configure identity and scope

Generate an issuer app as described in [onboarding](issuer-onboarding.md). Confirm the actual plan's payer route and authorized Wallet identity. Replace the enrollment file adapter with the issuer's authoritative system, using the [enrollment contract](intake.md#authoritative-enrollment-and-updates).

In the generated app:

```sh
cp auth.example.json auth.json
bun run pilot
```

Before starting, replace the example authorities and mappings in `auth.json`:

- `member` and `clinic` specify trusted token issuer, audience and HTTPS JWKS URL. These come from operator configuration, never from an unverified token.
- `members` maps a verified member subject to an internal enrollment key.
- `clinics` maps a verified clinic subject to its permitted member keys and canonical provider scope. Each grant contains `billingProviderNpi`, matching `provider.npi`, provider identity and optional encounter context. A public NPI is not an authentication credential.

The supplied adapter uses `jose` to verify signatures, issuer, audience, expiration and required subject/issued-at claims. Member and clinic tokens have separate configured audiences. It admits RS256, ES256 and EdDSA tokens. The issuer must issue appropriate access tokens through its existing identity provider; the SDK does not mint or distribute them.

Member requests use `Authorization: Bearer <member access token>`, or a `__Host-insurance-session` cookie set by the host's authenticated portal. When using cookies, the host must set Secure, HttpOnly, Path=/ and an appropriate SameSite policy and apply its normal session/CSRF protections. Clinic read requests use a bearer token with the clinic audience.

Grant lookups reread the local policy file for each authorized request. Restart after changing token authorities or signing configuration. For a deployed system, replace the directory callbacks with the issuer's existing member identity, clinic directory and member-access/consent services. Keep `auth.json`, enrollment and private keys outside version control.

Pilot mode fails at startup without valid policy configuration. It has its own card database and exposes no demo portal or fixture-update/session routes. It binds to loopback; a host deployment must provide HTTPS, application access controls and operational storage. Token verification alone does not establish a clinic's right to access every member; the member-specific grant is required on every read.

## Connect the member portal and reader

Add authenticated `/member/pass.pkpass` downloads to the existing member portal. `/member/pass.json` is an authenticated unsigned preview. `/reader/config` exposes only the public pass identifier and NFC readiness.

Once the signing checker passes, run the experimental reader from the framework checkout:

```sh
bun run reader issuer-vas \
  --issuer https://your-issuer.example \
  --token-env INSURANCE_READER_TOKEN \
  --out /private/new-intake-result.json
```

Set that environment variable through your normal secret/session mechanism with a short-lived clinic access token. Do not put the token in command arguments, captures or source files. The reader checks readiness before opening the hardware, polls the configured Wallet identity and sends its encrypted VAS envelope to `/clinic/vas`. It uses HTTPS outside loopback and follows no redirects. The backend authorizes the clinic for the resolved member and returns insurance, supplied benefits, the readable intake view and an unsent request. The result file is owner-only and never overwrites an existing file. Without `--out`, no patient details are printed.

The reader remains experimental; the offline setup checker cannot certify it. A successful simulated or fixture read is not a physical NFC result. Use an issuer-owned enhanced NFC certificate and verify the actual Wallet-to-reader handoff before representing it as tap-ready.

## Verify and stop

`bun run onboarding:verify` from the framework checkout generates and typechecks a detached app, exercises both response formats and enrollment update/termination/reissue, then verifies pilot mode rejects demo identity selectors. It uses fictional data and sends no payer inquiry. `bun run check` and the reader tests cover date interpretation, scope, persistence and protocol behavior.

For a real pilot, verify the signed-in member, clinic grant, billing NPI, payer route, dates and patient match against issuer-authorized records. Check that a termination event invalidates the existing reference and no unintended inquiry or billing write occurs. Capture the successful physical read separately from setup diagnostics.

Stop the reader/server to end the local pilot. Revoke the relevant card references and withdraw clinic grants when access ends. Existing Wallet passes may remain visible, but their revoked references stop resolving. Credential revocation does not terminate the insurance plan. Production audit, key/token lifecycle, VAS freshness/replay policy, EHR matching and Wallet push updates remain host responsibilities.
