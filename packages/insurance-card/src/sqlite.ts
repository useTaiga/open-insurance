import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import { parseBenefitsSnapshot } from "./benefits";
import { parseInsuranceData } from "./contract";
import type { CardStore, IssuedCard } from "./issuer";

export { SqliteMemberIndex } from "./sqlite-member-index";

export class SqliteCardStore implements CardStore {
  readonly #database: Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    this.#database = new Database(filename, { create: true });
    chmodSync(filename, 0o600);
    this.#database.run(
      "CREATE TABLE IF NOT EXISTS insurance_cards (message TEXT PRIMARY KEY, expires_at TEXT NOT NULL, insurance TEXT NOT NULL)"
    );
    if (
      !this.#database
        .query<{ name: string }, []>("PRAGMA table_info(insurance_cards)")
        .all()
        .some((column) => column.name === "benefits")
    ) {
      this.#database.run(
        "ALTER TABLE insurance_cards ADD COLUMN benefits TEXT"
      );
    }
  }

  get(message: string): IssuedCard | undefined {
    const row = this.#database
      .query<
        { expires_at: string; insurance: string; benefits: string | null },
        [string]
      >(
        "SELECT expires_at, insurance, benefits FROM insurance_cards WHERE message = ?"
      )
      .get(message);
    if (row === null) {
      return undefined;
    }
    const insurance = parseInsuranceData(JSON.parse(row.insurance));
    return {
      ...(row.benefits === null
        ? {}
        : {
            benefits: parseBenefitsSnapshot(
              JSON.parse(row.benefits),
              insurance
            ),
          }),
      expiresAt: row.expires_at,
      insurance,
      message,
    };
  }

  set(message: string, card: IssuedCard): void {
    this.#database
      .query(
        "INSERT OR REPLACE INTO insurance_cards (message, expires_at, insurance, benefits) VALUES (?, ?, ?, ?)"
      )
      .run(
        message,
        card.expiresAt,
        JSON.stringify(card.insurance),
        card.benefits === undefined
          ? null
          : JSON.stringify(parseBenefitsSnapshot(card.benefits, card.insurance))
      );
  }

  delete(message: string): boolean {
    return (
      this.#database
        .query("DELETE FROM insurance_cards WHERE message = ?")
        .run(message).changes > 0
    );
  }

  close(): void {
    this.#database.close();
  }
}
