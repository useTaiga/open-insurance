import type { EligibilityRequest, IssuedCard } from "@open-insurance/core";

import type { DemoState } from "./server";

const element = <T extends HTMLElement>(id: string, kind: new () => T): T => {
  const found = document.querySelector(`#${id}`);
  if (!(found instanceof kind)) {
    throw new TypeError(`Missing ${id}`);
  }
  return found;
};
const button = (id: string) => element(id, HTMLButtonElement);
const message = element("message", HTMLInputElement);
const insurance = element("insurance", HTMLTextAreaElement);
const sample = element("sample", HTMLSelectElement);
const show = (id: string, value: string) => {
  element(id, HTMLElement).textContent = value;
};
let state: DemoState | undefined;
let prepared: EligibilityRequest | undefined;
let rendered = "";

const details = (id: string, rows: [string, string, string?][]) => {
  const items = rows.map(([label, value, note]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    item.append(term, description);
    if (note !== undefined) {
      const context = document.createElement("small");
      context.textContent = note;
      item.append(context);
    }
    return item;
  });
  element(id, HTMLElement).replaceChildren(...items);
};

const renderDemo = (next: DemoState) => {
  const demo = next.publicDemo;
  element("demo-panel", HTMLElement).hidden = demo === undefined;
  if (demo === undefined) {
    return;
  }
  const personal = demo.dataMode === "personal-cache";
  element("demo-scenario-field", HTMLElement).hidden = personal;
  element("issuer-tools", HTMLElement).hidden = personal;
  element("request-panel", HTMLElement).hidden = personal;
  if (personal) {
    show("data-mode", "Personal prototype · saved eligibility");
    show("lab-title", "Your insurance, one tap away.");
    show(
      "lab-description",
      "Your NFC badge opens your insurance and a saved eligibility response on this Mac."
    );
    show("demo-kind", "NFC BADGE / YOUR SAVED INSURANCE");
    show(
      "demo-instructions",
      "Open the linked NFC Test Pass in Wallet and hold the top of your iPhone near the reader. Insurance details are looked up locally on this Mac."
    );
    show("demo-benefits-title", "Benefits returned by the payer");
    show(
      "demo-notice",
      "This displays a previous eligibility response. No new inquiry is sent. Confirm policyholder details before requesting a fresh check. Eligibility does not guarantee payment."
    );
  }
  element("demo-scenario", HTMLSelectElement).value = demo.scenario;
  const status = {
    failed: demo.error ?? "The badge was not read. Try again.",
    idle: "Ready. Start the reader, then tap your NFC Test Pass.",
    success: personal
      ? "NFC badge read. Your saved insurance result is ready."
      : "NFC badge read. Synthetic member found; sample result ready.",
    waiting: "Reader is listening. Hold your iPhone near the antenna…",
  }[demo.status];
  show("demo-reader-status", status);
  element("demo-reader-status", HTMLElement).dataset.status = demo.status;
  const result = next.readerResult;
  const eligibility = result?.eligibility;
  element("demo-result", HTMLElement).hidden =
    result === undefined || eligibility === undefined;
  if (result === undefined || eligibility === undefined) {
    return;
  }
  show("demo-member", result.memberName);
  show("demo-plan", eligibility.plan.name ?? "Sample plan");
  show(
    "demo-coverage",
    `${personal ? "Prior status" : "Sample"} · ${eligibility.status.toLowerCase()}`
  );
  if (result.checkedAt !== undefined) {
    show(
      "demo-notice",
      `Previously checked ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(result.checkedAt))}. This tap sent no new inquiry. Policyholder details must be confirmed before a fresh check. Eligibility does not guarantee payment.`
    );
  }
  const { subscriber } = result.request;
  details("demo-insurance", [
    [
      personal ? "Subscriber returned by payer" : "Policyholder",
      [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" "),
    ],
    ["Member ID", subscriber.memberId ?? "—"],
    ["Group", subscriber.groupNumber ?? "—"],
    [
      "Patient",
      (result.request.dependents?.length ?? 0) > 0 ? "Dependent" : "Subscriber",
    ],
    ["Provider NPI", result.request.provider.npi ?? "—"],
  ]);
  const currency = new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  });
  const percent = new Intl.NumberFormat("en-US", { style: "percent" });
  details(
    "demo-benefits",
    eligibility.benefits.map((benefit) => {
      let value = "—";
      if (benefit.amount !== undefined) {
        value = currency.format(Number(benefit.amount));
      } else if (benefit.percent !== undefined) {
        value = percent.format(Number(benefit.percent));
      } else if (benefit.quantity !== undefined) {
        value = [benefit.quantity, benefit.quantityQualifier]
          .filter(Boolean)
          .join(" ");
      }
      return [
        benefit.name,
        value,
        [
          ...benefit.serviceTypes,
          benefit.coverageLevel,
          benefit.network,
          benefit.timeQualifier,
          ...benefit.notes,
        ]
          .filter(Boolean)
          .join(" · "),
      ];
    })
  );
  show(
    "demo-payer-message",
    eligibility.errors.map((error) => error.description).join(" ") ||
      (eligibility.benefits.length === 0
        ? "No sample benefits for this outcome."
        : `${eligibility.benefits.length} ${personal ? "payer-returned" : "sample"} benefit entries. Network and coverage level are shown on each entry.`)
  );
};

const showError = (error: unknown) => {
  show("error", error instanceof Error ? error.message : "Request failed.");
  element("error", HTMLElement).hidden = false;
};
const api = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(
    path,
    body === undefined
      ? undefined
      : {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
  );
  const result: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      result !== null &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
        ? result.error
        : "Request failed."
    );
  }
  // These responses share their TypeScript contract with the local demo server.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return result as T;
};
const action = async (
  control: HTMLButtonElement,
  handler: () => Promise<void>
) => {
  element("error", HTMLElement).hidden = true;
  control.disabled = true;
  try {
    await handler();
  } catch (error) {
    showError(error);
  } finally {
    control.disabled = false;
  }
};
const download = (filename: string, value: unknown) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};
const showRequest = (request: EligibilityRequest | undefined) => {
  prepared = request;
  show(
    "request",
    request === undefined
      ? "Read a card reference to prepare the request."
      : JSON.stringify(request, null, 2)
  );
  show(
    "request-status",
    request === undefined ? "Waiting for a card read" : "Prepared · not sent"
  );
  button("copy").disabled = request === undefined;
  button("request-download").disabled = request === undefined;
  button("insurance-download").disabled = request === undefined;
};
const updateBytes = () => {
  show("bytes", `${new TextEncoder().encode(message.value).length} / 64 bytes`);
};
const renderCard = (card: IssuedCard, revoked: boolean) => {
  const patient = card.insurance.dependents?.[0] ?? card.insurance.subscriber;
  show(
    "member-name",
    [patient.firstName, patient.lastName].filter(Boolean).join(" ") || "Member"
  );
  show("member-id", card.insurance.subscriber.memberId ?? "See issuer");
  show("group", card.insurance.subscriber.groupNumber ?? "—");
  show("card-status", revoked ? "Revoked" : "Issued");
  message.value = card.message;
  updateBytes();
  for (const id of ["tap", "revoke", "download"]) {
    button(id).disabled = false;
  }
};
const refresh = async () => {
  const next = await api<DemoState>("/api/state");
  const serialized = JSON.stringify(next);
  if (serialized === rendered) {
    return;
  }
  const changedCard =
    next.currentCard?.message !== state?.currentCard?.message ||
    next.revoked !== state?.revoked;
  state = next;
  rendered = serialized;
  if (changedCard && next.currentCard !== undefined) {
    renderCard(next.currentCard, next.revoked);
  }
  show(
    "pass",
    JSON.stringify(next.pass, null, 2) ?? "Issue a card to preview pass.json."
  );
  showRequest(next.request);
  renderDemo(next);
  const benefits = next.readerResult?.benefits;
  element("benefits-panel", HTMLElement).hidden = benefits === undefined;
  if (benefits !== undefined) {
    show(
      "benefits-status",
      {
        expired: "Expired snapshot",
        "not-yet-valid": "Snapshot not yet valid",
        "within-validity": "Within supplied validity window",
      }[benefits.freshness]
    );
    show(
      "benefits-provenance",
      `${benefits.snapshot.source === "issuer" ? "Issuer-provided" : "Saved Stedi response"} · As of ${benefits.snapshot.asOf} · Expires ${benefits.snapshot.expiresAt}${benefits.snapshot.providerNpi === undefined ? "" : ` · Provider ${benefits.snapshot.providerNpi}`}`
    );
    show("benefits-json", JSON.stringify(benefits.snapshot.data, null, 2));
  }
  button("wallet-download").disabled =
    !next.walletReady || next.currentCard === undefined || next.revoked;
  let walletStatus = "Unsigned preview · Wallet signing is not configured";
  if (next.walletReady) {
    walletStatus =
      next.pass?.nfc === undefined
        ? "Signed Wallet test card · NFC disabled"
        : "Signed NFC pass · Apple NFC permission required";
  }
  show("wallet-status", walletStatus);
  show(
    "tag-status",
    next.tagLinked && !next.revoked
      ? "Physical tag linked locally · synthetic card"
      : "No physical tag linked to this card"
  );
};
const loadSample = () => {
  if (state !== undefined) {
    const data =
      sample.value === "dependent"
        ? state.samples.dependent
        : state.samples.subscriber;
    insurance.value = JSON.stringify(data, null, 2);
  }
};
sample.addEventListener("change", loadSample);
element("demo-scenario", HTMLSelectElement).addEventListener(
  "change",
  (event) => {
    if (!(event.currentTarget instanceof HTMLSelectElement)) {
      return;
    }
    const scenario = event.currentTarget.value;
    void api("/api/reader/demo-scenario", { scenario })
      .then(refresh)
      .catch(showError);
  }
);
message.addEventListener("input", updateBytes);
button("issue").addEventListener("click", () => {
  void action(button("issue"), async () => {
    const input: unknown = JSON.parse(insurance.value);
    const issued = await api<{ card: IssuedCard }>("/api/issue", input);
    if (
      element("include-benefits", HTMLInputElement).checked &&
      state !== undefined
    ) {
      await api("/api/benefits", {
        message: issued.card.message,
        snapshot: {
          asOf: new Date().toISOString(),
          data: state.samples.benefitsData,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          format: "stedi-eligibility-legacy",
          insurance: issued.card.insurance,
          source: "issuer",
        },
      });
    }
    await refresh();
  });
});
button("tap").addEventListener("click", () => {
  void action(button("tap"), async () => {
    showRequest(undefined);
    const result = await api<{ request: EligibilityRequest }>("/api/tap", {
      message: message.value,
    });
    await refresh();
    showRequest(result.request);
  });
});
button("revoke").addEventListener("click", () => {
  void action(button("revoke"), async () => {
    await api("/api/revoke", { message: state?.currentCard?.message });
    await refresh();
  });
});
button("download").addEventListener("click", () => {
  download("pass.json", state?.pass);
});
button("wallet-download").addEventListener("click", () => {
  window.location.href = "/api/wallet/pass.pkpass";
});
button("request-download").addEventListener("click", () => {
  download("stedi-request.json", prepared);
});
button("insurance-download").addEventListener("click", () => {
  if (prepared === undefined) {
    return;
  }
  download("insurance.json", {
    dependents: prepared.dependents,
    subscriber: prepared.subscriber,
    tradingPartnerName: prepared.tradingPartnerName,
    tradingPartnerServiceId: prepared.tradingPartnerServiceId,
  });
});
button("benefits-download").addEventListener("click", () => {
  if (state?.readerResult?.benefits !== undefined) {
    download("benefits-snapshot.json", state.readerResult.benefits.snapshot);
  }
});
button("copy").addEventListener("click", () => {
  void action(button("copy"), async () => {
    await navigator.clipboard.writeText(JSON.stringify(prepared, null, 2));
    show("copy", "Copied");
    setTimeout(() => {
      show("copy", "Copy request JSON");
    }, 1500);
  });
});
const start = async () => {
  try {
    await refresh();
    loadSample();
    setInterval(() => {
      void refresh().catch(showError);
    }, 1000);
  } catch (error) {
    showError(error);
  }
};
void start();
