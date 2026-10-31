import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseBenefitsSnapshot, readCardBenefits } from "./benefits";
import {
  createEligibilityRequest,
  parseClinicContext,
  parseInsuranceData,
} from "./contract";
import type { ClinicContext } from "./contract";
import { createInsurer } from "./insurer";
import type { MemberData } from "./insurer";
import { parseCardReference } from "./issuer";
import type { CardStore } from "./issuer";
import { inspectIssuerSetup, loadSigningCertificates } from "./setup";
import type { IssuerSetup } from "./setup";
import { decryptVasData, parseVasReadInput } from "./vas";

export interface MemberIndex {
  get: (payerId: string, memberKey: string) => string | undefined;
  member: (payerId: string, message: string) => string | undefined;
  set: (payerId: string, memberKey: string, message: string) => void;
  delete: (payerId: string, memberKey: string) => void;
}

export interface Enrollment {
  member: MemberData;
  expiresAt: Date;
  benefits?: unknown;
}

export interface IssuerIntegrationOptions {
  setup: IssuerSetup;
  directory: string;
  cards: CardStore;
  members: MemberIndex;
  authorizeMember: (request: Request) => Promise<string | undefined>;
  loadEnrollment: (memberKey: string) => Promise<Enrollment | undefined>;
  authorizeClinic: (
    request: Request,
    memberKey: string
  ) => Promise<ClinicContext | undefined>;
}

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const createIssuerIntegration = async (
  options: IssuerIntegrationOptions
) => {
  const { setup, directory, cards, members } = options;
  const { payerId } = setup;
  const issuer = await createInsurer({
    directory: async () => ({
      logo:
        setup.logo === undefined
          ? undefined
          : await readFile(path.resolve(directory, setup.logo)),
      name: setup.name,
      payerId,
    }),
    payerId,
    store: cards,
    wallet: setup.wallet,
  });
  const readiness = await inspectIssuerSetup(setup, directory);
  const signing = readiness.walletReady
    ? await loadSigningCertificates(setup, directory)
    : undefined;
  const readerKey =
    readiness.nfcReady && setup.readerPrivateKey !== undefined
      ? await readFile(path.resolve(directory, setup.readerPrivateKey), "utf-8")
      : undefined;

  const revoke = (memberKey: string) => {
    const message = members.get(payerId, memberKey);
    if (message !== undefined) {
      const existing = cards.get(message);
      if (existing && existing.insurance.tradingPartnerServiceId !== payerId) {
        throw new HttpError(403, "Card payer does not match this issuer.");
      }
      cards.delete(message);
      members.delete(payerId, memberKey);
    }
  };

  const refresh = async (memberKey: string, expectedMessage?: string) => {
    const enrollment = await options.loadEnrollment(memberKey);
    if (!enrollment || !(enrollment.expiresAt.getTime() > Date.now())) {
      revoke(memberKey);
      throw new HttpError(410, "No current enrollment is available.");
    }
    const insurance = parseInsuranceData({
      ...enrollment.member,
      tradingPartnerName: setup.name,
      tradingPartnerServiceId: payerId,
    });
    const benefits =
      enrollment.benefits === undefined
        ? undefined
        : parseBenefitsSnapshot(enrollment.benefits, insurance);
    const message = members.get(payerId, memberKey);
    if (expectedMessage !== undefined && message !== expectedMessage) {
      throw new HttpError(410, "Card is unavailable.");
    }
    if (message !== undefined) {
      const existing = cards.get(message);
      if (existing && existing.insurance.tradingPartnerServiceId !== payerId) {
        throw new HttpError(403, "Card payer does not match this issuer.");
      }
      if (
        existing &&
        Date.parse(existing.expiresAt) > Date.now() &&
        existing.insurance.tradingPartnerServiceId === payerId
      ) {
        const updated = {
          benefits,
          expiresAt: enrollment.expiresAt.toISOString(),
          insurance,
          message,
        };
        cards.set(message, updated);
        return issuer.resolve(message);
      }
      if (expectedMessage !== undefined) {
        throw new HttpError(410, "Card is unavailable.");
      }
      revoke(memberKey);
    }
    const card = issuer.issue(
      { dependents: insurance.dependents, subscriber: insurance.subscriber },
      enrollment.expiresAt,
      benefits
    );
    members.set(payerId, memberKey, card.message);
    return card;
  };

  const memberKey = async (request: Request) => {
    const key = await options.authorizeMember(request);
    if (key === undefined || key.length === 0) {
      throw new HttpError(401, "Member authentication is required.");
    }
    return key;
  };

  const read = async (request: Request, message: unknown) => {
    const reference = parseCardReference(message);
    const key = members.member(payerId, reference);
    if (key === undefined || key.length === 0) {
      throw new HttpError(404, "Card is unavailable.");
    }
    const scope = await options.authorizeClinic(request, key);
    if (!scope) {
      throw new HttpError(
        403,
        "Clinic authorization for this member is required."
      );
    }
    const clinic = parseClinicContext(scope);
    const card = await refresh(key, reference);
    const eligibilityRequest = createEligibilityRequest(card.insurance, clinic);
    const benefits =
      card.benefits?.providerNpi === undefined ||
      card.benefits.providerNpi === clinic.billingProviderNpi
        ? readCardBenefits(card, clinic.billingProviderNpi)
        : undefined;
    return Response.json({
      benefits: benefits ?? null,
      eligibilityRequest,
      insurance: card.insurance,
      sent: false,
    });
  };

  const fetch = async (request: Request): Promise<Response> => {
    let response: Response;
    try {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/health") {
        response = Response.json({
          nfcReady: readiness.nfcReady,
          payerId,
          physicalTap: "unverified",
          walletReady: readiness.walletReady,
        });
      } else if (
        request.method === "GET" &&
        ["/member/pass.json", "/member/pass.pkpass"].includes(pathname)
      ) {
        const key = await memberKey(request);
        if (
          pathname.endsWith(".pkpass") &&
          (!signing || (readiness.nfcConfigured && !readiness.nfcReady))
        ) {
          throw new HttpError(
            503,
            "Signing is blocked. Run the setup checker; NFC requests never fall back to an ordinary pass."
          );
        }
        const card = await refresh(key);
        response =
          pathname.endsWith(".json") || !signing
            ? Response.json(issuer.pass(card.message))
            : new Response(
                new Uint8Array(await issuer.sign(card.message, signing)),
                {
                  headers: {
                    "content-disposition":
                      "attachment; filename=insurance.pkpass",
                    "content-type": "application/vnd.apple.pkpass",
                  },
                }
              );
      } else if (request.method === "DELETE" && pathname === "/member/card") {
        revoke(await memberKey(request));
        response = new Response(null, { status: 204 });
      } else if (request.method === "POST" && pathname === "/clinic/read") {
        const body: unknown = await request.json();
        if (body === null || typeof body !== "object" || !("message" in body)) {
          throw new HttpError(400, "Provide a card message.");
        }
        response = await read(request, body.message);
      } else if (request.method === "POST" && pathname === "/clinic/vas") {
        if (readerKey === undefined) {
          throw new HttpError(
            503,
            "NFC signing and reader key checks must pass before enabling the VAS endpoint."
          );
        }
        const body = parseVasReadInput(await request.json());
        if (body.passTypeIdentifier !== setup.wallet.passTypeIdentifier) {
          throw new HttpError(
            400,
            "Reader pass identity does not match this issuer."
          );
        }
        const decoded = decryptVasData({
          passTypeIdentifier: body.passTypeIdentifier,
          privateKey: readerKey,
          vasData: Buffer.from(body.vasDataBase64, "base64"),
        });
        response = await read(request, decoded.message);
      } else {
        response = Response.json({ error: "Not found." }, { status: 404 });
      }
    } catch (error) {
      response =
        error instanceof HttpError
          ? Response.json({ error: error.message }, { status: error.status })
          : Response.json(
              {
                error:
                  "Request could not be processed. Check enrollment, scope and input.",
              },
              { status: 400 }
            );
    }
    response.headers.set("cache-control", "no-store");
    return response;
  };
  return { fetch, readiness, revoke };
};
