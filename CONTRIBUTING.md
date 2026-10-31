# Contributing

Open Insurance is maintained by [Taiga](https://github.com/useTaiga). Contributions are welcome under the project's [MIT license](LICENSE); no commercial agreement or visible branding requirement applies.

## Local development

Use the Bun version in [package.json](package.json):

```sh
bun install --frozen-lockfile
bun run check
bun run dev
```

`check` runs the SDK and HTTP tests, typechecks, and fictional issuer example. The local lab binds to loopback and makes no live eligibility inquiries.

Reader changes also require Python 3 and:

```sh
bun run reader:setup
bun run reader test
```

## Changes that help adoption

- Improve small, runnable examples and integration documentation.
- Add issuer-directory or storage adapters without requiring a hosted service.
- Preserve subscriber/dependent semantics, string identifiers and full benefit payloads.
- Add realistic parser, persistence and scope regressions through public entry points.
- Document hardware evidence and distinguish simulated behavior from physical reads.

Keep changes focused. Before deleting files or dependencies, check imports, package scripts, runtime assets and configuration. Use existing package scripts for verification. Pull request titles should follow `type(scope): subject`.

## Reproductions and reports

Use fictional members and placeholder credentials. Never commit or attach real patient data, private keys, signed personal passes, local profiles, database files or captures. Share the commit, environment, reproduction steps and observed result.

Report vulnerabilities through the [private reporting channel](SECURITY.md), not public issues. See [architecture](docs/architecture.md) before proposing changes to identity, authorization or reader trust.
