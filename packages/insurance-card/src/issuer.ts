import { randomBytes } from "node:crypto";

import { parseInsuranceData } from "./contract";
import type { InsuranceData } from "./contract";

const tokenPattern = /^ic1_[A-Za-z0-9_-]{32}$/u;
export const parseCardReference = (value: unknown): string => {
  if (typeof value !== "string" || !tokenPattern.test(value)) {
    throw new Error("Invalid insurance card reference.");
  }
  return value;
};

export interface IssuedCard {
  message: string;
  expiresAt: string;
  insurance: InsuranceData;
}

export interface CardStore {
  get: (message: string) => IssuedCard | undefined;
  set: (message: string, card: IssuedCard) => unknown;
  delete: (message: string) => boolean;
}

export class InsuranceCardIssuer {
  readonly #cards: CardStore;

  constructor(store: CardStore = new Map<string, IssuedCard>()) {
    this.#cards = store;
  }

  issue(data: unknown, expiresAt: Date): IssuedCard {
    if (!(expiresAt.getTime() > Date.now())) {
      throw new Error("The card expiry must be a future date.");
    }
    const card = {
      expiresAt: expiresAt.toISOString(),
      insurance: parseInsuranceData(data),
      message: `ic1_${randomBytes(24).toString("base64url")}`,
    };
    this.#cards.set(card.message, card);
    return structuredClone(card);
  }

  resolve(message: unknown): IssuedCard {
    const card = this.#cards.get(parseCardReference(message));
    if (!card || Date.parse(card.expiresAt) <= Date.now()) {
      throw new Error("This insurance card is unknown, expired, or revoked.");
    }
    return structuredClone(card);
  }

  revoke(message: unknown): boolean {
    return this.#cards.delete(parseCardReference(message));
  }
}
