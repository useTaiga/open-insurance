import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { InsuranceCardIssuer } from "./issuer";
import { benefitsDataSample, dependentSample } from "./samples";
import { SqliteCardStore } from "./sqlite";

test("legacy cards gain lossless benefits storage and retain revocation across restarts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "insurance-card-"));
  const filename = path.join(directory, "cards.sqlite");
  try {
    const card = new InsuranceCardIssuer().issue(
      dependentSample,
      new Date(Date.now() + 60_000)
    );
    const legacy = new Database(filename);
    legacy.run(
      "CREATE TABLE insurance_cards (message TEXT PRIMARY KEY, expires_at TEXT NOT NULL, insurance TEXT NOT NULL)"
    );
    legacy.run("INSERT INTO insurance_cards VALUES (?, ?, ?)", [
      card.message,
      card.expiresAt,
      JSON.stringify(card.insurance),
    ]);
    legacy.close();
    const firstStore = new SqliteCardStore(filename);
    const first = new InsuranceCardIssuer(firstStore);
    expect(first.resolve(card.message)).toEqual(card);
    const snapshot = {
      asOf: "2020-01-01T00:00:00Z",
      data: benefitsDataSample,
      expiresAt: "2020-01-02T00:00:00Z",
      format: "stedi-eligibility-legacy",
      insurance: card.insurance,
      source: "issuer",
    };
    first.setBenefits(card.message, snapshot);
    firstStore.close();
    const reopened = new SqliteCardStore(filename);
    const issuer = new InsuranceCardIssuer(reopened);
    const persisted: unknown = issuer.resolve(card.message);
    expect(persisted).toEqual({
      ...card,
      benefits: snapshot,
    });
    issuer.revoke(card.message);
    reopened.close();
    const finalStore = new SqliteCardStore(filename);
    expect(() =>
      new InsuranceCardIssuer(finalStore).resolve(card.message)
    ).toThrow("revoked");
    finalStore.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
