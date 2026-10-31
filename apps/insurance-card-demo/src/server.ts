import { createPrivateKey, createPublicKey } from "node:crypto";

import {
  createApplePassJson,
  createEligibilityRequest,
  decryptVasData,
  generateNfcKeys,
  InsuranceCardIssuer,
  parseVasReadInput,
  signApplePass,
} from "@open-insurance/core";
import type { EligibilityRequest, IssuedCard } from "@open-insurance/core";
import {
  clinicSample,
  dependentSample,
  subscriberSample,
} from "@open-insurance/core/samples";

import { preparedReaderResult, simulateReaderResult } from "./reader";
import type { ReaderResult, SimulationScenario } from "./reader";
import { readReaderConfiguration, readSigningConfiguration } from "./signing";
import type { DemoReaderConfiguration, DemoSigning } from "./signing";

export interface DemoState {
  clinic: typeof clinicSample;
  currentCard?: IssuedCard;
  pass?: ReturnType<typeof createApplePassJson>;
  request?: EligibilityRequest;
  readerResult?: ReaderResult;
  publicDemo?: {
    status: "idle" | "waiting" | "success" | "failed";
    scenario: SimulationScenario;
    error?: string;
    dataMode: "synthetic" | "personal-cache";
  };
  walletReady: boolean;
  vasReady: boolean;
  nfcPassReady: false;
  tagLinked: boolean;
  revoked: boolean;
  samples: {
    dependent: typeof dependentSample;
    subscriber: typeof subscriberSample;
  };
}

export const createDemo = (
  signing?: DemoSigning,
  options: DemoReaderConfiguration = {}
) => {
  const issuer = new InsuranceCardIssuer(options.store);
  const { publicDemo } = options;
  if (
    publicDemo !== undefined &&
    createPrivateKey(publicDemo.privateKey).asymmetricKeyDetails?.namedCurve !==
      "prime256v1"
  ) {
    throw new Error("The public NFC demo requires a P-256 reader key.");
  }
  const demoCard =
    publicDemo === undefined
      ? undefined
      : issuer.issue(
          publicDemo.profile?.insurance ?? dependentSample,
          new Date(Date.now() + 86_400_000)
        );
  let demoScenario: SimulationScenario = "active";
  let demoStatus: NonNullable<DemoState["publicDemo"]>["status"] = "idle";
  let demoError: string | undefined;
  let readerResult: ReaderResult | undefined;
  const privateKey =
    options.privateKey === undefined
      ? undefined
      : createPrivateKey(options.privateKey);
  if (
    privateKey !== undefined &&
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("VAS decryption requires a P-256 private key.");
  }
  const encryptionPublicKey =
    privateKey === undefined
      ? generateNfcKeys().encryptionPublicKey
      : createPublicKey(privateKey)
          .export({ format: "der", type: "spki" })
          .toString("base64");
  if (
    privateKey !== undefined &&
    signing?.issuer.encryptionPublicKey !== undefined &&
    signing.issuer.encryptionPublicKey !== encryptionPublicKey
  ) {
    throw new Error(
      "The VAS private key does not match the Wallet issuer encryption key."
    );
  }
  const walletIssuer = signing?.issuer ?? {
    encryptionPublicKey,
    organizationName: "Example Health",
    passTypeIdentifier: "pass.org.openinsurance.demo",
    teamIdentifier: "EXAMPLE001",
  };
  let currentCard: IssuedCard | undefined;
  let revoked = false;
  let request: EligibilityRequest | undefined;
  const tags = new Map<string, string>();

  const fetch = async (incoming: Request): Promise<Response> => {
    const { pathname } = new URL(incoming.url);
    if (incoming.method === "GET") {
      if (pathname === "/api/wallet/pass.pkpass") {
        if (signing === undefined) {
          return Response.json(
            { error: "Wallet signing is not configured." },
            { status: 503 }
          );
        }
        try {
          const card = issuer.resolve(currentCard?.message);
          const pass = await signApplePass(
            card,
            walletIssuer,
            signing.certificates
          );
          return new Response(new Uint8Array(pass), {
            headers: {
              "Cache-Control": "no-store",
              "Content-Disposition":
                'attachment; filename="insurance-test.pkpass"',
              "Content-Type": "application/vnd.apple.pkpass",
            },
          });
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error ? error.message : "Pass signing failed.",
            },
            { status: 400 }
          );
        }
      }
      if (pathname === "/api/reader/config") {
        return Response.json({
          eligibilityReady: false,
          nfcPassReady: false,
          passTypeIdentifier: walletIssuer.passTypeIdentifier,
          publicDemo:
            publicDemo === undefined
              ? undefined
              : {
                  dataMode:
                    publicDemo.profile === undefined
                      ? "synthetic"
                      : "personal-cache",
                  kind: "public-demo-badge",
                  passTypeIdentifier: publicDemo.passTypeIdentifier,
                  ready: true,
                },
          syntheticOnly: publicDemo?.profile === undefined,
          tagMode: "local-uid-link",
          vasReady: privateKey !== undefined,
        });
      }
      if (pathname === "/") {
        return new Response(Bun.file(new URL("index.html", import.meta.url)));
      }
      if (pathname === "/app.js") {
        const source = await Bun.file(
          new URL("app.ts", import.meta.url)
        ).text();
        return new Response(
          new Bun.Transpiler({ loader: "ts" }).transformSync(source),
          { headers: { "Content-Type": "text/javascript" } }
        );
      }
      if (pathname === "/style.css") {
        return new Response(Bun.file(new URL(`.${pathname}`, import.meta.url)));
      }
      if (pathname === "/api/state") {
        return Response.json(
          {
            clinic: clinicSample,
            currentCard,
            nfcPassReady: false,
            pass: currentCard
              ? createApplePassJson(currentCard, walletIssuer)
              : undefined,
            publicDemo:
              publicDemo === undefined
                ? undefined
                : {
                    dataMode:
                      publicDemo.profile === undefined
                        ? "synthetic"
                        : "personal-cache",
                    error: demoError,
                    scenario: demoScenario,
                    status: demoStatus,
                  },
            readerResult,
            request,
            revoked,
            samples: {
              dependent: dependentSample,
              subscriber: subscriberSample,
            },
            tagLinked:
              currentCard !== undefined &&
              [...tags.values()].includes(currentCard.message),
            vasReady: privateKey !== undefined,
            walletReady: signing !== undefined,
          } satisfies DemoState,
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      return new Response("Not found", { status: 404 });
    }
    if (incoming.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (
      publicDemo?.profile !== undefined &&
      !pathname.startsWith("/api/reader/demo-") &&
      pathname !== "/api/revoke"
    ) {
      return Response.json(
        {
          error:
            "Personal badge mode does not accept synthetic or other reader operations.",
        },
        { status: 409 }
      );
    }
    if (pathname === "/api/tap" || pathname.startsWith("/api/reader/")) {
      request = undefined;
      readerResult = undefined;
    }
    if (
      incoming.headers.get("content-type")?.split(";")[0] !== "application/json"
    ) {
      return new Response("Use application/json", { status: 415 });
    }
    if (pathname === "/api/reader/vas" && privateKey === undefined) {
      return Response.json(
        {
          error:
            "Apple VAS decryption is not configured. No card was resolved and no eligibility inquiry was sent.",
        },
        { status: 501 }
      );
    }
    try {
      const input: unknown = await incoming.json();
      if (pathname.startsWith("/api/reader/demo-")) {
        if (publicDemo === undefined || demoCard === undefined) {
          return Response.json(
            { error: "The public NFC badge demo is not configured." },
            { status: 501 }
          );
        }
        demoError = undefined;
        if (pathname === "/api/reader/demo-scenario") {
          if (publicDemo.profile !== undefined) {
            throw new Error(
              "Sample scenarios are unavailable for a personal saved result."
            );
          }
          const scenario =
            input !== null && typeof input === "object" && "scenario" in input
              ? input.scenario
              : undefined;
          if (
            scenario !== "active" &&
            scenario !== "inactive" &&
            scenario !== "rejected"
          ) {
            throw new Error("Choose an active, inactive, or rejected sample.");
          }
          demoScenario = scenario;
          demoStatus = "idle";
          return Response.json({ sent: false });
        }
        if (pathname === "/api/reader/demo-status") {
          if (
            input === null ||
            typeof input !== "object" ||
            !("status" in input)
          ) {
            throw new Error("Expected a reader status.");
          }
          if (input.status !== "waiting" && input.status !== "failed") {
            throw new Error("Expected a waiting or failed reader status.");
          }
          demoStatus = input.status;
          if ("error" in input && typeof input.error === "string") {
            demoError = input.error.slice(0, 500);
          }
          return Response.json({ sent: false });
        }
        if (pathname === "/api/reader/demo-badge") {
          const read = parseVasReadInput(input);
          if (read.passTypeIdentifier !== publicDemo.passTypeIdentifier) {
            throw new Error(
              "This Wallet pass is not linked to the public demo."
            );
          }
          const decrypted = decryptVasData({
            passTypeIdentifier: publicDemo.passTypeIdentifier,
            privateKey: publicDemo.privateKey,
            vasData: Buffer.from(read.vasDataBase64, "base64"),
          });
          if (decrypted.message !== publicDemo.message) {
            throw new Error(
              "This NFC badge is not linked to the configured member."
            );
          }
          const card = issuer.resolve(demoCard.message);
          request = createEligibilityRequest(
            card.insurance,
            publicDemo.profile?.clinic ?? clinicSample
          );
          currentCard = card;
          revoked = false;
          readerResult =
            publicDemo.profile === undefined
              ? simulateReaderResult(card, request, demoScenario)
              : {
                  ...preparedReaderResult(card, request),
                  checkedAt: publicDemo.profile.checkedAt,
                  eligibility: publicDemo.profile.result,
                  mode: "cached",
                };
          demoStatus = "success";
          return Response.json(readerResult);
        }
      }
      if (pathname === "/api/reader/vas" && privateKey !== undefined) {
        const read = parseVasReadInput(input);
        if (read.passTypeIdentifier !== walletIssuer.passTypeIdentifier) {
          throw new Error(
            "This VAS read belongs to a different Wallet issuer."
          );
        }
        const decrypted = decryptVasData({
          passTypeIdentifier: walletIssuer.passTypeIdentifier,
          privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
          vasData: Buffer.from(read.vasDataBase64, "base64"),
        });
        const card = issuer.resolve(decrypted.message);
        request = createEligibilityRequest(card.insurance, clinicSample);
        currentCard = card;
        revoked = false;
        return Response.json(preparedReaderResult(card, request));
      }
      if (
        pathname === "/api/reader/tag/enroll" ||
        pathname === "/api/reader/tag/read"
      ) {
        const identifier =
          input !== null && typeof input === "object" && "identifier" in input
            ? input.identifier
            : undefined;
        if (
          typeof identifier !== "string" ||
          !/^(?:[0-9a-f]{8}|[0-9a-f]{14}|[0-9a-f]{20})$/u.test(identifier)
        ) {
          throw new Error("Expected a 4, 7, or 10-byte NFC-A chip identifier.");
        }
        if (pathname === "/api/reader/tag/enroll") {
          if (currentCard === undefined || revoked) {
            throw new Error("Issue a synthetic card before linking a tag.");
          }
          issuer.resolve(currentCard.message);
          tags.set(identifier, currentCard.message);
          request = undefined;
          return Response.json({ linked: true, sent: false });
        }
        const card = issuer.resolve(tags.get(identifier));
        currentCard = card;
        revoked = false;
        request = createEligibilityRequest(card.insurance, clinicSample);
        return Response.json(preparedReaderResult(card, request));
      }
      if (pathname === "/api/reader/simulate") {
        const scenario =
          input !== null && typeof input === "object" && "scenario" in input
            ? input.scenario
            : undefined;
        if (
          scenario !== "active" &&
          scenario !== "inactive" &&
          scenario !== "rejected"
        ) {
          throw new Error(
            "Choose an active, inactive, or rejected simulation."
          );
        }
        const card = issuer.issue(
          dependentSample,
          new Date(Date.now() + 3_600_000)
        );
        request = createEligibilityRequest(
          issuer.resolve(card.message).insurance,
          clinicSample
        );
        currentCard = card;
        revoked = false;
        return Response.json(simulateReaderResult(card, request, scenario));
      }
      if (pathname === "/api/issue") {
        currentCard = issuer.issue(input, new Date(Date.now() + 3_600_000));
        revoked = false;
        request = undefined;
        readerResult = undefined;
        return Response.json({
          card: currentCard,
          pass: createApplePassJson(currentCard, walletIssuer),
        });
      }
      const message =
        input !== null && typeof input === "object" && "message" in input
          ? input.message
          : undefined;
      if (pathname === "/api/tap") {
        const card = issuer.resolve(message);
        request = createEligibilityRequest(card.insurance, clinicSample);
        return Response.json({
          message: card.message,
          request,
          sent: false,
          status: "prepared",
        });
      }
      if (pathname === "/api/reader/read") {
        const card = issuer.resolve(message);
        request = createEligibilityRequest(card.insurance, clinicSample);
        return Response.json(preparedReaderResult(card, request));
      }
      if (pathname === "/api/revoke") {
        issuer.revoke(message);
        if (message === currentCard?.message) {
          revoked = true;
          request = undefined;
          readerResult = undefined;
        }
        return Response.json({ revoked: true });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (pathname.startsWith("/api/reader/demo-")) {
        demoStatus = "failed";
        demoError =
          error instanceof Error ? error.message : "NFC demo read failed.";
      }
      return Response.json(
        {
          error:
            error instanceof Error ? error.message : "Invalid card request.",
        },
        { status: 400 }
      );
    }
  };
  return { fetch };
};

if (import.meta.main) {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(process.env.INSURANCE_CARD_PORT ?? 4320),
    ...createDemo(
      await readSigningConfiguration(),
      await readReaderConfiguration()
    ),
  });
  process.stdout.write(
    `Open Insurance demo: ${server.url}\nLocal Wallet badge prototype. This server sends no live eligibility inquiries.\n`
  );
}
