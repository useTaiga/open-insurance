import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { InsuranceCardIssuer } from "./issuer";
import { dependentSample } from "./samples";
import { SqliteCardStore } from "./sqlite";

test("card identity, insurance, and revocation survive a resolver restart", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "insurance-card-"));
  const filename = path.join(directory, "cards.sqlite");
  try {
    const firstStore = new SqliteCardStore(filename);
    const card = new InsuranceCardIssuer(firstStore).issue(
      dependentSample,
      new Date(Date.now() + 60_000)
    );
    firstStore.close();
    const reopened = new SqliteCardStore(filename);
    const issuer = new InsuranceCardIssuer(reopened);
    expect(issuer.resolve(card.message)).toEqual(card);
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
