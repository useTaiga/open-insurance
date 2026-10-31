# Insurance Reader for iPhone

An experimental SwiftUI receiver for the [issuer lab](../insurance-card-demo/README.md). It displays fictional benefits, resolves demo references and includes a Core NFC VAS adapter. Original code is [MIT licensed](LICENSE).

## Run

Requires macOS, Xcode with the iOS SDK, Swift 6 and [XcodeGen](https://github.com/yonaskolb/XcodeGen). From the repository root:

```sh
bun install --frozen-lockfile
bun run dev
```

In another terminal:

```sh
bun run --cwd apps/insurance-card-reader ios:launch
```

The launch script uses an installed iPhone 17 Pro Simulator. `ios:build` builds for a generic simulator without installing or launching. The app's Connection screen sets its server address; Simulator defaults to `http://localhost:4320` on the Mac.

On a physical iPhone, `localhost` means that iPhone. Use an SSH local forward or a private server address reachable from the device. The lab binds to Mac loopback. Local HTTP is for fictional development data; a deployed connection requires HTTPS and its own access controls.

## Reader modes

- **Simulate card read** issues and resolves a fictional dependent card, then displays a labeled active, inactive or rejected result. It sends no payer inquiry.
- **Resolve a demo reference** resolves an `ic1_…` reference issued by the same running lab and displays its prepared, unsent inquiry.
- **Scan Wallet card** uses Apple's `NFCVASReaderSession`. Successful VAS data and mobile token bytes are sent as Base64 to `/api/reader/vas` for backend decryption.

Each attempt clears the previous result. Request and result data stay in memory; the server address is saved locally. No payer credential or VAS private key belongs in the app.

## Signing and NFC

The project contains no development team or signing credentials. For physical installation, configure your own Apple Developer team and provisioning in Xcode. The default bundle identifier is `org.openinsurance.reader.demo`; select an identifier authorized for your own signing setup.

The app has empty entitlements and `VASReaderApproved` is false. Physical NFC requires Apple's approved reader provisioning and entitlement configuration, plus an NFC-enabled signed pass on the presenting iPhone. Changing a flag does not grant permission. See [Apple's VAS reader documentation](https://developer.apple.com/documentation/corenfc/nfcvasreadersession) and [pass NFC requirements](https://developer.apple.com/documentation/walletpasses/pass/nfc-data.dictionary).

The lab rejects VAS reads until decryption is configured. Decoder readiness does not establish Apple approval or a successful physical read. The native adapter has not been validated with an approved reader profile and our own NFC insurance pass.

This app is a fictional lab client. An issuer-authorized clinic deployment must implement the [pilot authentication and member-access model](../../docs/pilot.md). The app supplies no production clinic authentication or live eligibility sending.

## Checks

```sh
bun run --cwd apps/insurance-card-reader ios:test
bun run --cwd apps/insurance-card-reader ios:test:integration
bun run --cwd apps/insurance-card-reader ios:lint
bun run --cwd apps/insurance-card-reader ios:build
bun run --cwd apps/insurance-card-reader ios:check-device
```

`ios:test:integration` requires the lab on port 4320 and exercises the actual Swift HTTP client. `ios:test` skips the HTTP test unless `READER_TEST_SERVER_URL` is set. Both build commands disable signing. Native checks use `ios:*` scripts so the root software tests can run without Xcode on Linux.
