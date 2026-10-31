import Ajv from "ajv";
import type { SchemaObject } from "ajv";

import type { components } from "./generated/stedi";
import sourceSchema from "./generated/stedi.schema.json";

export type EligibilityRequest =
  components["schemas"]["EligibilityCheckRequestContent"];
export type InsuranceData = Pick<
  EligibilityRequest,
  "tradingPartnerServiceId" | "tradingPartnerName" | "subscriber" | "dependents"
>;
export interface ClinicContext {
  billingProviderNpi: string;
  provider: EligibilityRequest["provider"];
  encounter?: EligibilityRequest["encounter"];
  externalPatientId?: EligibilityRequest["externalPatientId"];
}

const strictObjects = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(strictObjects);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const object: Record<string, unknown> = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, strictObjects(item)])
  );
  return object.type === "object" && object.properties !== undefined
    ? { ...object, additionalProperties: false }
    : object;
};

const ajv = new Ajv({ allErrors: true, strict: false });
const strictSchema = (schema: SchemaObject): SchemaObject => {
  const result = strictObjects(schema);
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Expected an object schema.");
  }
  return result;
};
const validateRequest = ajv.compile<EligibilityRequest>(
  strictSchema(sourceSchema)
);
const { properties } =
  sourceSchema.components.schemas.EligibilityCheckRequestContent;
const validateInsurance = ajv.compile<InsuranceData>(
  strictSchema({
    additionalProperties: false,
    components: sourceSchema.components,
    properties: {
      dependents: properties.dependents,
      subscriber: properties.subscriber,
      tradingPartnerName: properties.tradingPartnerName,
      tradingPartnerServiceId: properties.tradingPartnerServiceId,
    },
    required: ["tradingPartnerServiceId", "subscriber"],
    type: "object",
  })
);
const validateClinic = ajv.compile<ClinicContext>(
  strictSchema({
    components: sourceSchema.components,
    properties: {
      billingProviderNpi: { pattern: "^[0-9]{10}$", type: "string" },
      encounter: properties.encounter,
      externalPatientId: properties.externalPatientId,
      provider: properties.provider,
    },
    required: ["billingProviderNpi", "provider"],
    type: "object",
  })
);

export const parseClinicContext = (value: unknown): ClinicContext => {
  if (!validateClinic(value)) {
    throw new Error(
      `Invalid clinic context: ${ajv.errorsText(validateClinic.errors)}`
    );
  }
  return value;
};

export const parseInsuranceData = (value: unknown): InsuranceData => {
  if (!validateInsurance(value)) {
    throw new Error(
      `Invalid insurance data: ${ajv.errorsText(validateInsurance.errors)}`
    );
  }
  if (
    ![
      value.subscriber.memberId,
      value.subscriber.dateOfBirth,
      value.subscriber.lastName,
    ].some((field) => field !== undefined && field.length > 0)
  ) {
    throw new Error(
      "subscriber needs memberId, dateOfBirth, or lastName to identify the member."
    );
  }
  const transport = JSON.stringify(value);
  const normalized: unknown = JSON.parse(transport);
  if (!validateInsurance(normalized)) {
    throw new Error("Insurance could not be represented as JSON.");
  }
  return normalized;
};

export const createEligibilityRequest = (
  data: unknown,
  clinic: ClinicContext
): EligibilityRequest => {
  if (
    !/^\d{10}$/u.test(clinic.billingProviderNpi) ||
    clinic.provider.npi !== clinic.billingProviderNpi
  ) {
    throw new Error(
      "The clinic provider NPI must match its verified billing-provider scope."
    );
  }
  if (
    !(
      (clinic.provider.organizationName ?? "").length > 0 ||
      ((clinic.provider.firstName ?? "").length > 0 &&
        (clinic.provider.lastName ?? "").length > 0)
    )
  ) {
    throw new Error(
      "provider needs organizationName or firstName and lastName."
    );
  }
  const request = {
    ...parseInsuranceData(data),
    provider: structuredClone(clinic.provider),
    ...(clinic.encounter === undefined
      ? {}
      : { encounter: structuredClone(clinic.encounter) }),
    ...(clinic.externalPatientId === undefined
      ? {}
      : { externalPatientId: clinic.externalPatientId }),
  };
  if (!validateRequest(request)) {
    throw new Error(
      `Invalid Stedi request: ${ajv.errorsText(validateRequest.errors)}`
    );
  }
  return request;
};
