# Issuer and clinic lab

Start with `bun run dev` from the project root and open http://127.0.0.1:4320. The lab binds to loopback and sends no live eligibility inquiries.

## Linked Wallet badge

See the [Wallet and NFC lab](../../README.md#wallet-and-nfc-lab) for configuration. The separate `wallet-demo` command reads a linked public test badge and shows fictional benefits or an explicitly configured, dated saved result. It does not issue an insurer credential or authenticate a patient.

See [reader instructions](reader/README.md) for PN532 setup and diagnostics.
