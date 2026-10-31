import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { MemberIndex } from "./integration";

export class SqliteMemberIndex implements MemberIndex {
  readonly #database: Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { mode: 0o700, recursive: true });
    this.#database = new Database(filename, { create: true });
    chmodSync(filename, 0o600);
    this.#database.run(
      "CREATE TABLE IF NOT EXISTS insurance_members (payer_id TEXT NOT NULL, member_key TEXT NOT NULL, message TEXT NOT NULL UNIQUE, PRIMARY KEY (payer_id, member_key))"
    );
  }

  get(payerId: string, memberKey: string): string | undefined {
    return this.#database
      .query<{ message: string }, [string, string]>(
        "SELECT message FROM insurance_members WHERE payer_id = ? AND member_key = ?"
      )
      .get(payerId, memberKey)?.message;
  }

  member(payerId: string, message: string): string | undefined {
    return this.#database
      .query<{ member_key: string }, [string, string]>(
        "SELECT member_key FROM insurance_members WHERE payer_id = ? AND message = ?"
      )
      .get(payerId, message)?.member_key;
  }

  set(payerId: string, memberKey: string, message: string): void {
    this.#database
      .query(
        "INSERT INTO insurance_members (payer_id, member_key, message) VALUES (?, ?, ?) ON CONFLICT (payer_id, member_key) DO UPDATE SET message = excluded.message"
      )
      .run(payerId, memberKey, message);
  }

  delete(payerId: string, memberKey: string): void {
    this.#database
      .query(
        "DELETE FROM insurance_members WHERE payer_id = ? AND member_key = ?"
      )
      .run(payerId, memberKey);
  }

  close(): void {
    this.#database.close();
  }
}
