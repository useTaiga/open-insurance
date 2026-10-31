import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { intakeSummarySchema } from "../src/intake";

const { values } = parseArgs({ options: { sdk: { type: "string" } } });
const sdk = path.resolve(
  values.sdk ?? fileURLToPath(new URL("../../../", import.meta.url))
);
const manifest = z
  .object({ name: z.literal("open-insurance") })
  .safeParse(await Bun.file(path.join(sdk, "package.json")).json());
if (!manifest.success) {
  throw new Error("Provide --sdk <standalone export directory>.");
}
const temporary = await mkdtemp(path.join(tmpdir(), "issuer-reference-"));
const project = path.join(temporary, "angle");
const run = async (command: string[], cwd: string) => {
  const process = Bun.spawn(command, {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  });
  assert.equal(await process.exited, 0, `Failed: ${command.join(" ")}`);
};
const start = async (pilot: boolean) => {
  const child = Bun.spawn([process.execPath, "run", pilot ? "pilot" : "dev"], {
    cwd: project,
    env: { ...Bun.env, PORT: "0" },
    stderr: "inherit",
    stdout: "pipe",
  });
  const ready = async () => {
    const reader = child.stdout.getReader();
    let text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          throw new Error("Reference server exited before becoming ready.");
        }
        text += new TextDecoder().decode(chunk.value);
        const url = /http:\/\/127\.0\.0\.1:\d+\//u.exec(text)?.[0];
        if (url !== undefined) {
          return url;
        }
      }
    } finally {
      reader.releaseLock();
    }
  };
  const timeout = new AbortController();
  try {
    const url = await Promise.race([
      ready(),
      delay(30_000, undefined, { signal: timeout.signal }).then(() => {
        throw new Error("Reference server did not start within 30 seconds.");
      }),
    ]);
    return { process: child, url };
  } catch (error) {
    child.kill();
    await child.exited;
    throw error;
  } finally {
    timeout.abort();
  }
};
const passSchema = z.object({ serialNumber: z.string() });
const readSchema = z.object({
  intake: intakeSummarySchema,
  sent: z.literal(false),
});
const api = async (
  url: string,
  route: string,
  member: string,
  body?: unknown
) =>
  await fetch(new URL(route, url), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      cookie: `demo-member=${member}`,
      "x-demo-clinic": "fixture",
    },
    method: body === undefined ? "GET" : "POST",
  });

try {
  await run(
    [
      process.execPath,
      "run",
      "onboarding",
      "init",
      "--payer",
      "angle",
      "--out",
      project,
      "--sdk",
      `file:${sdk}`,
    ],
    sdk
  );
  await run([process.execPath, "install"], project);
  await run([process.execPath, "run", "--bun", "typecheck"], project);
  const doctor = Bun.spawn([process.execPath, "run", "doctor"], {
    cwd: project,
    stderr: "pipe",
    stdout: "pipe",
  });
  const report: unknown = JSON.parse(await new Response(doctor.stdout).text());
  assert.equal(await doctor.exited, 1);
  z.object({
    nfcConfigured: z.literal(true),
    nfcReady: z.literal(false),
    walletReady: z.literal(false),
  }).parse(report);
  const demo = await start(false);
  try {
    for (const [member, shape] of [
      ["subscriber", "legacy"],
      ["dependent", "plans"],
    ]) {
      const response = await api(demo.url, "/member/pass.json", member);
      assert.equal(response.status, 200);
      const card = passSchema.parse(await response.json());
      const read = await api(demo.url, "/clinic/read", member, {
        message: card.serialNumber,
      });
      assert.equal(read.status, 200);
      const initial = readSchema.parse(await read.json());
      assert.equal(initial.intake.shape, shape);
      assert.equal(
        initial.intake.dates.find((period) => period.kind === "plan")?.end,
        "2026-12-31"
      );
      const change = await api(demo.url, "/demo/enrollment", member, {
        action: "change-copay",
      });
      assert.equal(change.status, 200);
      const updated = await api(demo.url, "/clinic/read", member, {
        message: card.serialNumber,
      });
      const current = readSchema.parse(await updated.json());
      assert.equal(
        current.intake.plans
          .flatMap((plan) => plan.benefits)
          .find((benefit) => benefit.category === "coPayment")?.amount,
        "35.00"
      );
      const termination = await api(demo.url, "/demo/enrollment", member, {
        action: "terminate",
      });
      assert.equal(termination.status, 200);
      const revoked = await api(demo.url, "/clinic/read", member, {
        message: card.serialNumber,
      });
      assert.equal(revoked.status, 404);
      const ineligible = await api(demo.url, "/member/pass.json", member);
      assert.equal(ineligible.status, 410);
      const restore = await api(demo.url, "/demo/enrollment", member, {
        action: "restore",
      });
      assert.equal(restore.status, 200);
      const replacement = await api(demo.url, "/member/pass.json", member);
      assert.notEqual(
        passSchema.parse(await replacement.json()).serialNumber,
        card.serialNumber
      );
    }
  } finally {
    demo.process.kill();
    await demo.process.exited;
  }
  await copyFile(
    path.join(project, "auth.example.json"),
    path.join(project, "auth.json")
  );
  const pilot = await start(true);
  try {
    const denied = await api(pilot.url, "/member/pass.json", "subscriber");
    assert.equal(denied.status, 401);
    const noDemo = await api(pilot.url, "/demo/enrollment", "subscriber", {
      action: "restore",
    });
    assert.equal(noDemo.status, 404);
    const noPortal = await fetch(pilot.url);
    assert.equal(noPortal.status, 404);
  } finally {
    pilot.process.kill();
    await pilot.process.exited;
  }
  process.stdout.write(
    "Detached onboarding verified: both response shapes, benefits updates, termination/reissue, and pilot isolation.\n"
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
