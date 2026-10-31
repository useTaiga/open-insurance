import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { partnerPrototypes } from "../examples/partners";
import { generateNfcKeys } from "../src/index";
import {
  benefitsDataSample,
  benefitsPlansSample,
  dependentSample,
  subscriberSample,
} from "../src/samples";
import { inspectIssuerSetup, readIssuerSetup } from "../src/setup";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    json: { type: "boolean" },
    out: { type: "string" },
    payer: { type: "string" },
    sdk: { type: "string" },
    "wallet-only": { type: "boolean" },
  },
});

if (positionals[0] === "doctor") {
  const filename = path.resolve(values.config ?? "issuer.json");
  try {
    const report = await inspectIssuerSetup(
      await readIssuerSetup(filename),
      path.dirname(filename)
    );
    process.stdout.write(
      values.json === true
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${report.checks.map((check) => `${check.status.toUpperCase()} ${check.id}: ${check.detail}`).join("\n")}\n\nWallet signing: ${report.walletReady ? "ready" : "blocked"}\nNFC configuration: ${report.nfcReady ? "ready for a physical test" : "blocked"}\n`
    );
    process.exitCode = (
      report.nfcConfigured ? report.nfcReady : report.walletReady
    )
      ? 0
      : 1;
  } catch {
    process.stderr.write(
      "Invalid or unreadable issuer configuration. Check the JSON schema and configured path.\n"
    );
    process.exitCode = 1;
  }
} else if (positionals[0] === "init" && values.out !== undefined) {
  const partner = partnerPrototypes.find(
    (item) => item.slug === (values.payer ?? "angle")
  );
  if (!partner) {
    throw new Error("Choose --payer angle, curative or oscar.");
  }
  const output = path.resolve(values.out);
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { mode: 0o700 });
  const save = async (filename: string, content: unknown) => {
    await writeFile(
      path.join(output, filename),
      `${JSON.stringify(content, null, 2)}\n`,
      { flag: "wx", mode: 0o600 }
    );
  };
  const keys = generateNfcKeys();
  await writeFile(path.join(output, "reader-private.pem"), keys.privateKey, {
    flag: "wx",
    mode: 0o600,
  });
  await save("issuer.json", {
    logo: "logo.png",
    name: partner.name,
    payerId: partner.payerId,
    readerPrivateKey: "reader-private.pem",
    wallet: {
      branding: {
        background: partner.background,
        foreground: "#ffffff",
        label: "#ffffff",
      },
      demo: true,
      organizationName: partner.name,
      passTypeIdentifier: "pass.com.example.insurance",
      teamIdentifier: "EXAMPLE123",
      ...(values["wallet-only"] === true
        ? {}
        : { encryptionPublicKey: keys.encryptionPublicKey }),
    },
  });
  await copyFile(
    new URL(`../assets/prototypes/${partner.slug}.png`, import.meta.url),
    path.join(output, "logo.png")
  );
  const asOf = new Date();
  const credentialExpiresAt = new Date(
    asOf.getTime() + 30 * 86_400_000
  ).toISOString();
  const enrollments = Object.fromEntries(
    (
      [
        ["subscriber", subscriberSample],
        ["dependent", dependentSample],
      ] as const
    ).map(([key, sample]) => {
      const insurance = {
        ...sample,
        tradingPartnerName: partner.name,
        tradingPartnerServiceId: partner.payerId,
      };
      return [
        key,
        {
          benefits: {
            asOf: asOf.toISOString(),
            data:
              key === "dependent"
                ? {
                    ...benefitsPlansSample,
                    payer: { name: { organization: partner.name } },
                    payerId: partner.payerId,
                  }
                : {
                    ...benefitsDataSample,
                    demo: true,
                    payer: { name: partner.name },
                  },
            expiresAt: new Date(asOf.getTime() + 86_400_000).toISOString(),
            format:
              key === "dependent"
                ? "stedi-eligibility-2026-06-01"
                : "stedi-eligibility-legacy",
            insurance,
            source: "issuer",
          },
          credentialExpiresAt,
          member: {
            dependents: insurance.dependents,
            subscriber: insurance.subscriber,
          },
          status: "active",
        },
      ];
    })
  );
  await save("enrollments.json", enrollments);
  await save("enrollments.seed.json", enrollments);
  await save("package.json", {
    dependencies: {
      "open-insurance": values.sdk ?? "github:useTaiga/open-insurance",
      zod: "^4.6.7",
    },
    devDependencies: {
      "@types/bun": "^1.4.4",
      "@types/node": "^26.6.5",
      typescript: "^6.0.3",
    },
    name: `${partner.slug}-insurance-reference`,
    private: true,
    scripts: {
      dev: "bun server.ts",
      doctor: "bun doctor.ts",
      pilot: "INSURANCE_MODE=pilot bun server.ts",
      typecheck: "tsc --noEmit",
    },
    type: "module",
  });
  await save("tsconfig.json", {
    compilerOptions: {
      module: "Preserve",
      moduleResolution: "Bundler",
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: "ESNext",
      types: ["bun", "node"],
    },
    include: ["*.ts"],
  });
  for (const name of [
    "server.ts",
    "doctor.ts",
    "enrollment.ts",
    "portal.html",
    "portal.css",
    "portal.ts",
    "authorization.ts",
    "demo.ts",
    "auth.example.json",
    "README.md",
    ".gitignore",
  ]) {
    await writeFile(
      path.join(output, name),
      await readFile(
        new URL(`../templates/issuer/${name}.template`, import.meta.url)
      ),
      { flag: "wx", mode: 0o600 }
    );
  }
  process.stdout.write(
    `Created fictional ${partner.name} reference in ${output}.\nRun bun install, bun run doctor, then bun run dev there.\nApple credentials and production authentication are not included.\n`
  );
} else {
  process.stdout.write(
    "Usage: onboarding init --payer angle|curative|oscar --out <new directory> [--wallet-only]\n       onboarding doctor --config <issuer.json> [--json]\n"
  );
  process.exitCode = 1;
}
