# Third-party components

Original project code is MIT licensed. Dependency licenses remain their own; the MIT license does not relicense them.

- The Python reader uses `nfcpy` (EUPL) and its dependencies as separately installed packages. Their source is not vendored here. Distribution of modified or bundled dependencies requires reviewing their licenses.
- `ber-tlv` supplies BER-TLV parsing under MIT.
- `passkit-generator`, Ajv and Zod supply signing/validation utilities under their respective licenses.
- VAS/ECP behavior follows public protocol research linked in the reader documentation. No Proxmark3 or upstream ECP override source is copied here.
- Generated Stedi field signatures and constraints derive from the external OpenAPI source identified by the included provenance hash. Vendor descriptions and examples are excluded.
- Apple, Apple Wallet and insurer names/marks belong to their owners. No affiliation, approval, production certification or endorsement is implied.
