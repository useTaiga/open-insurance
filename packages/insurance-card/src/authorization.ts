import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";

import { parseClinicContext } from "./contract";
import type { ClinicContext } from "./contract";

export interface TokenAuthority {
  issuer: string;
  audience: string;
  key: JWTVerifyGetKey;
}

export const remoteTokenAuthority = (config: {
  issuer: string;
  audience: string;
  jwksUrl: string;
}): TokenAuthority => {
  const url = new URL(config.jwksUrl);
  if (url.protocol !== "https:") {
    throw new Error(
      "Use an HTTPS JWKS URL from your configured identity provider."
    );
  }
  return {
    audience: config.audience,
    issuer: config.issuer,
    key: createRemoteJWKSet(url),
  };
};

const bearer = (request: Request) => {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") === true ? header.slice(7) : undefined;
};
const subject = async (
  token: string | undefined,
  authority: TokenAuthority
) => {
  if (token === undefined || token.length === 0) {
    return undefined;
  }
  try {
    const { payload } = await jwtVerify(token, authority.key, {
      algorithms: ["RS256", "ES256", "EdDSA"],
      audience: authority.audience,
      issuer: authority.issuer,
      requiredClaims: ["sub", "exp", "iat"],
    });
    return payload.sub;
  } catch {
    return undefined;
  }
};

export const createJwtAuthorization = (options: {
  member: TokenAuthority;
  clinic: TokenAuthority;
  loadMemberKey: (subject: string) => Promise<string | undefined>;
  loadClinicGrant: (
    subject: string,
    memberKey: string
  ) => Promise<ClinicContext | undefined>;
  readMemberToken?: (request: Request) => string | undefined;
}) => ({
  authorizeClinic: async (request: Request, memberKey: string) => {
    const identity = await subject(bearer(request), options.clinic);
    if (identity === undefined) {
      return undefined;
    }
    const grant = await options.loadClinicGrant(identity, memberKey);
    if (grant === undefined) {
      return undefined;
    }
    const clinic = parseClinicContext(grant);
    if (clinic.provider.npi !== clinic.billingProviderNpi) {
      throw new Error(
        "Clinic grant must match its verified billing-provider NPI."
      );
    }
    return clinic;
  },
  authorizeMember: async (request: Request) => {
    const identity = await subject(
      options.readMemberToken?.(request) ?? bearer(request),
      options.member
    );
    return identity === undefined
      ? undefined
      : await options.loadMemberKey(identity);
  },
});
