import Ajv from "ajv";

import type { PayerDirectory } from "./insurer";

interface Payer {
  primaryPayerId: string;
  stediId: string;
  displayName: string;
  avatarUrl?: string;
}
interface SearchResult {
  items: { payer: Payer }[];
  nextPageToken?: string;
}
const payerBackgrounds: Record<string, string> = {
  HPQRS: "#7f4098",
  KMQTZ: "#062c76",
  NRHDN: "#0067ac",
  NSIEN: "#0067ac",
};
const nonemptyString = { minLength: 1, type: "string" };
const validate = new Ajv().compile<SearchResult>({
  properties: {
    items: {
      items: {
        properties: {
          payer: {
            properties: {
              avatarUrl: nonemptyString,
              displayName: nonemptyString,
              primaryPayerId: nonemptyString,
              stediId: nonemptyString,
            },
            required: ["primaryPayerId", "stediId", "displayName"],
            type: "object",
          },
        },
        required: ["payer"],
        type: "object",
      },
      type: "array",
    },
    nextPageToken: nonemptyString,
  },
  required: ["items"],
  type: "object",
});

export const createStediPayerDirectory = (options: {
  apiKey: string;
}): PayerDirectory => {
  if (!options.apiKey) {
    throw new Error("A server-side Stedi API key is required.");
  }
  return async (payerId) => {
    const matches: Payer[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(
        "https://payers.us.stedi.com/2024-04-01/payers/search"
      );
      url.searchParams.set("query", payerId);
      url.searchParams.set("pageSize", "100");
      if (pageToken !== undefined) {
        url.searchParams.set("pageToken", pageToken);
      }
      const response = await fetch(url, {
        headers: { Authorization: options.apiKey },
      });
      if (!response.ok) {
        throw new Error(`Stedi payer lookup failed (${response.status}).`);
      }
      const result: unknown = await response.json();
      if (!validate(result)) {
        throw new Error("Invalid Stedi payer directory response.");
      }
      matches.push(
        ...result.items
          .map(({ payer }) => payer)
          .filter(
            (payer) =>
              payer.primaryPayerId === payerId || payer.stediId === payerId
          )
      );
      pageToken = result.nextPageToken;
    } while (pageToken !== undefined);
    if (matches.length !== 1) {
      throw new Error("Expected one exact primary payer ID or Stedi ID match.");
    }
    const [payer] = matches;
    let logo: Buffer | undefined;
    if (payer.avatarUrl !== undefined) {
      const url = new URL(payer.avatarUrl);
      if (url.protocol !== "https:") {
        throw new Error("The payer logo must use HTTPS.");
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Payer logo download failed (${response.status}).`);
      }
      logo = Buffer.from(await response.arrayBuffer());
    }
    return {
      ...(payerBackgrounds[payer.stediId] === undefined
        ? {}
        : {
            branding: {
              background: payerBackgrounds[payer.stediId],
              foreground: "#ffffff",
              label: "#ffffff",
            },
          }),
      logo,
      name: payer.displayName,
      payerId,
      stediId: payer.stediId,
    };
  };
};
