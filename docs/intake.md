# Coverage and supplied benefits

`summarizeBenefits(snapshot)` produces a readable view of the full supplied JSON. Import it from `open-insurance`, or import its browser-safe schema and types from `open-insurance/intake`. Both clinic read endpoints return this view as `intake`; `benefits.snapshot.data` retains the complete original object, including fields that the view does not interpret.

## Response formats

The view accepts Stedi's legacy `benefitsInformation` response and its `plans` response. Request composition still uses the bundled legacy eligibility request contract; reading a supplied response does not send a request to either endpoint. See Stedi's [response shapes](https://www.stedi.com/docs/healthcare/eligibility-response-shapes).

Legacy benefits are grouped by their supplied `planCoverage`. New responses keep the payer's `plans` grouping. Missing names remain missing. Unsupported or ambiguous shapes, payer errors/warnings and nonstandard benefit containers produce review messages; their original data remains available in JSON.

## Three separate clocks

| Value | Meaning |
| --- | --- |
| Coverage dates inside the response | The payer's reported plan, eligibility, policy or benefit periods. |
| Snapshot `asOf` / `expiresAt` | Observation and validity of the supplied benefits snapshot. These do not establish coverage. |
| Enrollment `credentialExpiresAt` | Expiration of the issued card reference. This is not the insurance termination date. |

Legacy dates come from `planDateInformation`. The new format uses `subscriber.dates`, or `dependent.dates` when the card identifies a dependent. Missing dependent dates never inherit the policyholder's dates. The date view keeps plan, eligibility, policy and benefit periods separate and records their source paths.

Benefit entries keep their own dates. They are not merged into the patient's plan period. Review those dates for that service before using the broader plan period, following Stedi's [active coverage and dates guidance](https://www.stedi.com/docs/healthcare/eligibility-active-coverage-benefits).

Missing starts/ends display **Not supplied**. A single legacy date stays a reported point date; it is not converted into an unlimited coverage period. Invalid calendar dates, reversed ranges and conflicting explicit/range dates require reviewing the original response. The SDK does not decide visit eligibility or automatically terminate enrollment from a benefit date.

Signed Wallet cards show supplied coverage periods and snapshot provenance on the back. Existing installed cards retain their downloaded snapshot until replaced or updated by an issuer pass-update service; the resolver refreshes authoritative enrollment on each read. Apple push-based pass updates are not included.

## Financial details and status

Each benefit remains a separate row with its service, amount/percentage/quantity, network, coverage level, time period, authorization indicator, messages and benefit dates. Individual and family amounts are not combined. Annual and remaining amounts are not added or subtracted. Zero is preserved. Original decimal strings remain available in the source JSON.

Coverage statuses apply to their listed services. A reported active benefit is not a universal active-coverage decision. Pending statuses remain pending. Network indicators describe the benefit; they do not establish whether the requesting clinic participates. See Stedi's [network and authorization guidance](https://www.stedi.com/docs/healthcare/eligibility-network-status-authorization-referrals).

The reference intake renders tables, dates, filters, source timestamps, review messages and full JSON. Failed reads and member changes clear the previous patient's result. No payment amount is calculated and no eligibility inquiry is sent.

## Authoritative enrollment and updates

Active enrollment records require `status: "active"`, `credentialExpiresAt`, `member`, and optional `benefits`. A termination may be only `{ "status": "terminated" }`; old or malformed benefit metadata cannot prevent that revocation. `parseEnrollment(record, { payerId, name })` validates the record and converts its credential timestamp to a `Date`. Host adapters may return a `Date` directly. The payer binding comes from issuer configuration.

After authenticating an enrollment event in the issuer's own webhook or job, call `integration.sync(memberKey)`. It updates an existing reference, returns `not-issued` for members who have no card, or revokes a terminated/missing/expired enrollment. It does not issue an unsolicited card. Omitting benefits clears the previous snapshot; updating a snapshot preserves the supplied timestamps.

Termination persists through the durable card/member stores. Further reads of the old reference fail. Member download remains blocked while the authoritative record is terminated. If enrollment is restored, a subsequent authenticated download issues a new reference. `integration.revoke(memberKey)` also invalidates a compromised credential; it does not terminate the underlying insurance policy.

Use the generated portal's **Test issuer updates** controls to change a fictional copay, terminate enrollment and restore its seed. The policyholder fixture exercises the legacy response; the dependent fixture exercises the newer response and different dependent coverage dates. These routes are unavailable in pilot mode.
