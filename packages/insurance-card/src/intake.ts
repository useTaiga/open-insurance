import { format, isValid, parse } from "date-fns";
import { z } from "zod";

import type { BenefitsSnapshot } from "./benefits";

const periodSchema = z.object({
  end: z.string().nullable(),
  invalid: z.boolean(),
  kind: z.string(),
  on: z.string().nullable(),
  sources: z.array(z.string()),
  start: z.string().nullable(),
});
const benefitSchema = z.object({
  amount: z.string().nullable(),
  authorization: z.string().nullable(),
  category: z.string(),
  coverageLevel: z.string().nullable(),
  dates: z.array(periodSchema),
  description: z.string().nullable(),
  insuranceType: z.string().nullable(),
  label: z.string(),
  messages: z.array(z.string()),
  network: z.string().nullable(),
  percent: z.string().nullable(),
  quantity: z.string().nullable(),
  services: z.array(
    z.object({
      code: z.string(),
      name: z.string().nullable(),
      system: z.string(),
    })
  ),
  source: z.string(),
  status: z.string().nullable(),
  timePeriod: z.string().nullable(),
});
export const intakeSummarySchema = z.object({
  dates: z.array(periodSchema),
  issues: z.array(z.string()),
  patient: z.enum(["subscriber", "dependent"]),
  plans: z.array(
    z.object({ benefits: z.array(benefitSchema), name: z.string().nullable() })
  ),
  shape: z.enum(["legacy", "plans", "unrecognized"]),
});
export type IntakeSummary = z.infer<typeof intakeSummarySchema>;
export type CoveragePeriod = z.infer<typeof periodSchema>;

const object = (value: unknown): Record<string, unknown> => {
  const result = z.record(z.string(), z.unknown()).safeParse(value);
  return result.success ? result.data : {};
};
const string = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const strings = (value: unknown) =>
  array(value).flatMap((item) => (typeof item === "string" ? [item] : []));

const kinds = ["plan", "eligibility", "policy", "benefit"] as const;
const legacyDateFields = {
  benefit: ["benefit", "benefitBegin", "benefitEnd"],
  eligibility: ["eligibility", "eligibilityBegin", "eligibilityEnd"],
  plan: ["plan", "planBegin", "planEnd"],
  policy: ["policy", "policyEffective", "policyExpiration"],
} as const;

const dates = (
  dateInput: unknown,
  source: string,
  modern: boolean,
  issues: string[]
): CoveragePeriod[] => {
  const data = object(dateInput);
  const readDate = (value: unknown, field: string) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      const pattern = /^\d{8}$/u.test(value) ? "yyyyMMdd" : "yyyy-MM-dd";
      const date = parse(value, pattern, new Date(0));
      if (isValid(date) && format(date, pattern) === value) {
        return format(date, "yyyy-MM-dd");
      }
    }
    issues.push(`${field}: invalid date; review the original response.`);
    return null;
  };
  return kinds.flatMap((kind) => {
    const [full, begin, end] = legacyDateFields[kind];
    const fields = modern ? object(data[kind]) : data;
    const keys = modern ? ["start", "end"] : [full, begin, end];
    const present = keys.filter((key) => fields[key] !== undefined);
    if (present.length === 0) {
      return [];
    }
    const count = issues.length;
    const prefix = modern ? `${source}.${kind}` : source;
    let start = readDate(
      fields[modern ? "start" : begin],
      `${prefix}.${modern ? "start" : begin}`
    );
    let finish = readDate(
      fields[modern ? "end" : end],
      `${prefix}.${modern ? "end" : end}`
    );
    let on: string | null = null;
    if (!modern && fields[full] !== undefined) {
      const whole = string(fields[full]);
      if (whole !== null && /^\d{8}-\d{8}$/u.test(whole)) {
        const [first, last] = whole.split("-");
        const from = readDate(first, `${source}.${full}`);
        const to = readDate(last, `${source}.${full}`);
        if (
          (start !== null && from !== start) ||
          (finish !== null && to !== finish)
        ) {
          issues.push(
            `${source}.${full}: conflicting dates; review the original response.`
          );
        }
        start ??= from;
        finish ??= to;
      } else {
        on = readDate(fields[full], `${source}.${full}`);
      }
    }
    if (start !== null && finish !== null && start > finish) {
      issues.push(
        `${prefix}: end precedes start; review the original response.`
      );
    }
    return [
      {
        end: finish,
        invalid: issues.length > count,
        kind,
        on,
        sources: present.map((key) => `${prefix}.${key}`),
        start,
      },
    ];
  });
};

const legacyCategories: Record<string, string> = {
  A: "coInsurance",
  B: "coPayment",
  C: "deductible",
  G: "outOfPocket",
};
const categoryNames: Record<string, string> = {
  benefitDisclaimer: "Benefit disclaimer",
  coInsurance: "Coinsurance",
  coPayment: "Copay",
  deductible: "Deductible",
  outOfPocket: "Out of pocket",
  statuses: "Coverage status",
};
const statusNames: Record<string, string> = {
  "1": "Active coverage",
  "2": "Active — full risk capitation",
  "3": "Active — services capitated",
  "4": "Active — services capitated to primary care",
  "5": "Active — pending investigation",
  "6": "Inactive",
  "7": "Inactive — pending eligibility update",
  "8": "Inactive — pending investigation",
};

const benefit = (
  value: unknown,
  category: string,
  source: string,
  modern: boolean,
  issues: string[]
) => {
  const data = object(value);
  if (Object.keys(data).length === 0) {
    issues.push(
      `${source}: unrecognized benefit; review the original response.`
    );
  }
  const code = string(data.code);
  const services = modern
    ? [object(data.service)].flatMap((service) => {
        const serviceCode = string(service.value);
        return serviceCode === null
          ? []
          : [
              {
                code: serviceCode,
                name: string(service.definition),
                system: string(service.system) ?? "Not supplied",
              },
            ];
      })
    : strings(data.serviceTypeCodes).map((serviceCode, index) => ({
        code: serviceCode,
        name: strings(data.serviceTypes)[index] ?? null,
        system: "STC",
      }));
  const status = modern
    ? string(data.status)
    : (statusNames[code ?? ""] ?? null);
  let normalizedCategory = category;
  if (!modern) {
    normalizedCategory = legacyCategories[code ?? ""] ?? "other";
    if (status !== null) {
      normalizedCategory = "statuses";
    }
  }
  return {
    amount: string(data[modern ? "amount" : "benefitAmount"]),
    authorization: string(
      data[modern ? "priorAuthIndicator" : "authOrCertIndicator"]
    ),
    category: normalizedCategory,
    coverageLevel: string(data.coverageLevel),
    dates: dates(
      data[modern ? "dates" : "benefitsDateInformation"],
      `${source}.${modern ? "dates" : "benefitsDateInformation"}`,
      modern,
      issues
    ),
    description: string(data.planCoverageDescription),
    insuranceType: string(data.insuranceType),
    label: string(data.name) ?? categoryNames[normalizedCategory] ?? category,
    messages: modern
      ? strings(data.messages)
      : array(data.additionalInformation).flatMap((item) => {
          const description = string(object(item).description);
          return description === null ? [] : [description];
        }),
    network: modern
      ? string(object(data.network).indicator)
      : string(data.inPlanNetworkIndicator),
    percent: string(data[modern ? "percent" : "benefitPercent"]),
    quantity: string(data[modern ? "quantity" : "benefitQuantity"]),
    services,
    source,
    status,
    timePeriod: string(data[modern ? "timePeriod" : "timeQualifier"]),
  };
};

export const summarizeBenefits = (
  snapshot: BenefitsSnapshot
): IntakeSummary => {
  const { data } = snapshot;
  const issues: string[] = [];
  if (array(data.errors).length > 0) {
    issues.push(
      "Payer response contains errors. Review the original response before using these benefits."
    );
  }
  if (array(data.warnings).length > 0) {
    issues.push(
      "Payer response contains warnings. Review the original response."
    );
  }
  const patient =
    (snapshot.insurance.dependents?.length ?? 0) > 0
      ? "dependent"
      : "subscriber";
  const modern = Array.isArray(data.plans);
  const legacy = Array.isArray(data.benefitsInformation);
  if (modern === legacy) {
    return {
      dates: [],
      issues: [
        ...issues,
        "Response shape is unrecognized or ambiguous. Review the complete supplied JSON.",
      ],
      patient,
      plans: [],
      shape: "unrecognized",
    };
  }
  if (modern) {
    const person = object(data[patient]);
    if (patient === "dependent" && Object.keys(person).length === 0) {
      issues.push(
        "Dependent dates were not supplied; subscriber dates have not been substituted."
      );
    }
    const coverageDates = dates(person.dates, `${patient}.dates`, true, issues);
    const plans = array(data.plans).map((value, planIndex) => {
      const plan = object(value);
      const benefits = Object.entries(object(plan.benefits)).flatMap(
        ([category, entries]) => {
          if (!Array.isArray(entries)) {
            issues.push(
              `plans[${planIndex}].benefits.${category}: unrecognized entries; review the original response.`
            );
            return [];
          }
          return entries.map((entry, index) =>
            benefit(
              entry,
              category,
              `plans[${planIndex}].benefits.${category}[${index}]`,
              true,
              issues
            )
          );
        }
      );
      return { benefits, name: string(plan.name) };
    });
    return { dates: coverageDates, issues, patient, plans, shape: "plans" };
  }
  const coverageDates = dates(
    data.planDateInformation,
    "planDateInformation",
    false,
    issues
  );
  const grouped = new Map<string | null, z.infer<typeof benefitSchema>[]>();
  for (const [index, value] of array(data.benefitsInformation).entries()) {
    const name = string(object(value).planCoverage);
    const entries = grouped.get(name) ?? [];
    entries.push(
      benefit(
        value,
        "Other benefit",
        `benefitsInformation[${index}]`,
        false,
        issues
      )
    );
    grouped.set(name, entries);
  }
  return {
    dates: coverageDates,
    issues,
    patient,
    plans: [...grouped].map(([name, benefits]) => ({ benefits, name })),
    shape: "legacy",
  };
};
