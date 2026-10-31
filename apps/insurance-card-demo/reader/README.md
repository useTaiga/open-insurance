# PN532 insurance reader

Python hardware adapter for the loopback [issuer demo](../README.md). It supports NFC-A chip-ID linking and an experimental Apple VAS reader. It never sends payment commands, modifies cards, or calls Stedi.

## Setup and checks

```sh
bun run --cwd apps/insurance-card-demo reader:setup
bun run --cwd apps/insurance-card-demo reader doctor
bun run --cwd apps/insurance-card-demo reader test
```

The reader auto-selects a single FT232R adapter. Override with `--device tty:usbserial-<serial>:pn532` on Mac. `NFC_READER_PYTHON` can select another installed Python environment. Commands close the device on completion, timeout, or Control-C. Only one process may own the serial port.

## Wallet diagnostics

```sh
bun run --cwd apps/insurance-card-demo reader vas-probe --timeout 15
```

Hold the unlocked iPhone near the PN532 antenna. The probe emits VAS-only ECP polling and attempts to select the Apple VAS applet over ISO-DEP. It does not request pass data, decrypt anything, or contact the backend. A successful selection identifies the wallet protocol; it does not prove an insurance card transfer. A polling timeout does not establish whether a pass is installed or eligible.

`--no-ecp` disables the experimental ECP emission. This requires manual pass selection/authentication and may not activate Wallet routing. The implementation currently supports PN532 at 106A only. Reader or pass certification is not established by these diagnostics.

## Public demo validation

[PassKit's public NFC Test Pass](https://pub1.pskt.io/c/gn1v07) can test the reader separately from our pending Apple NFC permission. Open the link in Safari on an iPhone and add the test pass to Wallet. The current demo's identifier is `pass.com.passkit.pksamples.nfcdemo`. Its details deliberately publish its reader private key, and describe the pass as intended for development and testing of Apple VAS hardware. In the downloaded package these are the localized `custom.encryptionKey.value` and `universal.info.value` fields in `en.lproj/pass.strings`. Verify these against a freshly downloaded demo if PassKit changes it. The key is also published in the research author's [reader configuration](https://github.com/kormax/android-universal-reader/blob/main/assets/configuration.json) under the PassKit merchant.

```sh
bun run --cwd apps/insurance-card-demo reader vas-capture \
  --pass-type-identifier pass.com.passkit.pksamples.nfcdemo \
  --out /tmp/passkit-nfc-capture.json --timeout 15
```

This diagnostic requests an encrypted payload for the explicit pass identifier. It makes no backend requests, performs no decryption, and sends no eligibility inquiry. The output is a new owner-only file (mode `0600`); existing files are never overwritten. It contains the complete SELECT and GET DATA response APDUs in base64, including their status words, and the parsed encrypted envelope when successful. A rejected exchange preserves responses received so far and an error. Discovery timeouts have no response APDUs. Keep captures outside Git.

Select the NFC Test Pass in Wallet and hold the top of the unlocked iPhone near the antenna for the capture window. If the reader asks for authentication (`6287` or `6984`), authenticate the pass and retry with a new output filename. The reader does not automatically retry a rejected exchange.

The SDK's offline diagnostic can decrypt a successful capture with the reader key deliberately published for that same public demo:

```sh
bun run --cwd packages/insurance-card insurance-card vas-decrypt \
  --capture /tmp/passkit-nfc-capture.json \
  --nfc-private-key /path/outside-git/to/published-demo-reader.pem
```

Do not use the public demo key for our insurance issuer or route the demo payload to its resolver. The published research transcript's `beef7375` key-ID header differs from the current demo key's `c0b77375`; the unmodified transcript correctly fails the key check. An explicitly labeled offline copy with only that header corrected authenticates its unchanged ciphertext and decrypts to the historical demo message. That checks the SDK against published ciphertext, and is separate from a physical device capture.

This validates an existing third-party demo pass only. It neither enables NFC on the ordinary insurance prototype nor grants Apple approval. A successful demo read proves the reader path, not our own pass issuance or an insurance eligibility result. The normal `vas` command retains all readiness checks below.

## Encrypted Wallet reads

For a locally linked test badge, use `reader wallet-demo --timeout 30` with the separate configuration described in the [lab README](../README.md#linked-wallet-badge). This path compares the decrypted public-pass identifier against an explicit local link and displays synthetic or previously saved eligibility. It does not interpret the identifier as an issuer credential and sends no live inquiry.

```sh
bun run --cwd apps/insurance-card-demo reader vas --timeout 30
```

The reader checks `/api/reader/config` before opening hardware. Both `nfcPassReady` and `vasReady` must be true, and the backend must identify itself as synthetic and preparation-only. The ordinary signed Wallet test pass has NFC disabled and cannot satisfy these requirements. These flags do not grant Apple permission; the operator must independently verify an NFC-authorized signing certificate before enabling the pass.

Apple's [WWDR Certification Practice Statement v1.32](https://images.apple.com/certificateauthority/pdf/Apple_WWDR_CPS_v1.32.pdf), sections 2.2.22 and 4.11.17, describes Enhanced Pass Certificates for NFC passes and includes custom extension `1.2.840.113635.100.6.1.26` in that profile. The public demo's signing leaf contains that extension; our ordinary test signing certificate does not. The ordinary pass extension `1.2.840.113635.100.6.1.16` appears in both and does not establish NFC permission.

The protocol selects `OSE.VAS.01`, verifies the ApplePay label, VAS version, and capabilities, then requests the exact configured pass identifier using SHA-256. GET DATA uses VAS-only mode with a random terminal nonce. A successful response is parsed as BER-TLV. The raw `9F27` cryptogram and optional `9F2A` mobile token are sent to `/api/reader/vas`:

```json
{
  "passTypeIdentifier": "pass.example.insurance",
  "vasDataBase64": "<raw cryptogram, not the complete APDU>",
  "mobileTokenBase64": "<mobile token, empty when absent>"
}
```

Decryption keys remain on the issuer backend. Missing passes, locked phones, malformed responses, and non-Apple wallets fail without substituting simulated benefits or treating an NFC identifier as insurance data. The reader deselects and mutes the field after a VAS exchange. The timeout bounds discovery; transport and HTTP operations have their own finite timeouts.

## Protocol sources and dependencies

- [Apple VAS protocol research](https://github.com/kormax/apple-vas)
- [ECP protocol research](https://github.com/kormax/apple-enhanced-contactless-polling)
- [VAS protocol specification research](https://gist.github.com/gm3197/ad0959476346cef69b75ea0523214350)
- [nfcpy](https://nfcpy.readthedocs.io/en/latest/) supplies serial transport, radio/ISO-DEP operations, APDU encoding, and CRC-A. It is an external EUPL dependency; its source is not vendored here.
- [ber-tlv](https://pypi.org/project/ber-tlv/) supplies BER-TLV parsing and serialization under MIT.

The Python implementation is original code using the public protocol descriptions. No upstream ECP override or Proxmark3 source is copied into the project. Protocol fixtures cover request composition, the published VAS response shape, and rejection of locked, missing, malformed, duplicate, or incompatible responses. They are software tests, not a substitute for a physical read from an NFC-authorized Wallet pass.

## Authenticated issuer integration

`issuer-vas` targets the SDK issuer API instead of the local lab. It checks `/reader/config` before opening the reader, requires the configured NFC identity to be ready and submits the encrypted envelope with a clinic bearer token to `/clinic/vas`. No eligibility inquiry is sent. Non-loopback URLs require HTTPS, redirects are rejected and tokens are read from an environment variable rather than command arguments.

```sh
bun run --cwd apps/insurance-card-demo reader issuer-vas \
  --issuer https://your-issuer.example \
  --token-env INSURANCE_READER_TOKEN \
  --out /private/new-intake-result.json
```

The result file contains the authorized insurance, complete supplied benefits, readable intake view and unsent request. It is owner-only and cannot overwrite an existing file. Without `--out`, patient details are not printed. The issuer must authorize this clinic for the resolved member; possession of a token or public NPI alone is insufficient. The [public pilot workflow](https://github.com/useTaiga/open-insurance/blob/main/docs/pilot.md) owns setup and verification. Existing diagnostic/lab commands are unchanged. This command does not certify the PN532 or enable an ordinary Wallet pass for NFC.
