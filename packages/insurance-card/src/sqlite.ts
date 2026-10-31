import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import { parseInsuranceData } from "./contract";
import type { CardStore, IssuedCard } from "./issuer";

export class SqliteCardStore implements CardStore {
  readonly #database: Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    this.#database = new Database(filename, { create: true });
    chmodSync(filename, 0o600);
    this.#database.run(
      "CREATE TABLE IF NOT EXISTS insurance_cards (message TEXT PRIMARY KEY, expires_at TEXT NOT NULL, insurance TEXT NOT NULL)"
    );
  }

  get(message: string): IssuedCard | undefined {
    const row = this.#database
      .query<{ expires_at: string; insurance: string }, [string]>(
        "SELECT expires_at, insurance FROM insurance_cards WHERE message = ?"
      )
      .get(message);
    if (row === null) {
      return undefined;
    }
    const insurance: unknown = JSON.parse(row.insurance);
    return {
      expiresAt: row.expires_at,
      insurance: parseInsuranceData(insurance),
      message,
    };
  }

  set(message: string, card: IssuedCard): void {
    this.#database
      .query(
        "INSERT OR REPLACE INTO insurance_cards (message, expires_at, insurance) VALUES (?, ?, ?)"
      )
      .run(message, card.expiresAt, JSON.stringify(card.insurance));
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
