export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    EligibilityCheckRequestContent: {
      /** @deprecated */
      controlNumber?: string;
      dependents?: components["schemas"]["RequestDependent"][];
      eligibilitySearchId?: string;
      encounter?: components["schemas"]["Encounter"];
      externalPatientId?: string;
      /** @deprecated */
      informationReceiverName?: components["schemas"]["InformationReceiverName"];
      portalPassword?: string;
      portalUsername?: string;
      provider: components["schemas"]["Provider"];
      submitterTransactionIdentifier?: string;
      subscriber: components["schemas"]["RequestSubscriber"];
      tradingPartnerName?: string;
      tradingPartnerServiceId: string;
    };
    RequestDependent: {
      additionalIdentification?: components["schemas"]["AdditionalIdentificationDependent"];
      address?: components["schemas"]["RequestDependentAddress"];
      beginningCardIssueDate?: string;
      beginningPlanIssueDate?: string;
      birthSequenceNumber?: string;
      dateOfBirth?: string;
      eligibilityCategory?: string;
      endCardIssueDate?: string;
      endPlanIssueDate?: string;
      firstName?: string;
      gender?: components["schemas"]["Gender"];
      groupNumber?: string;
      healthCareCodeInformation?: components["schemas"]["HealthCareInformation"][];
      idCard?: string;
      idCardIssueDate?: string;
      individualRelationshipCode?: components["schemas"]["IndividualRelationshipCode"];
      issueNumber?: string;
      lastName?: string;
      /** @deprecated */
      memberId?: string;
      middleName?: string;
      planIssueDate?: string;
      providerCode?: components["schemas"]["RequestDependentProviderCode"];
      providerIdentifier?: string;
      referenceIdentificationQualifier?: components["schemas"]["RequestDependentReferenceIdentificationQualifier"];
      ssn?: string;
      suffix?: string;
    };
    AdditionalIdentificationDependent: {
      agencyClaimNumber?: string;
      contractNumber?: string;
      healthInsuranceClaimNumber?: string;
      identificationCardSerialNumber?: string;
      insurancePolicyNumber?: string;
      medicalRecordIdentificationNumber?: string;
      memberIdentificationNumber?: string;
      patientAccountNumber?: string;
      planNetworkIdentificationNumber?: string;
      planNumber?: string;
      policyNumber?: string;
    };
    RequestDependentAddress: {
      address1: string;
      address2?: string;
      city: string;
      countryCode?: string;
      countrySubDivisionCode?: string;
      postalCode?: string;
      state?: components["schemas"]["RequestStateOrProvinceCode"];
    };
    /** @enum {string} */
    RequestStateOrProvinceCode:
      | "NL"
      | "PE"
      | "NS"
      | "NB"
      | "QC"
      | "ON"
      | "MB"
      | "SK"
      | "AB"
      | "BC"
      | "YT"
      | "NT"
      | "NU"
      | "DC"
      | "AS"
      | "GU"
      | "MP"
      | "PR"
      | "UM"
      | "VI"
      | "AA"
      | "AE"
      | "AP"
      | "AK"
      | "AL"
      | "AR"
      | "AZ"
      | "CA"
      | "CO"
      | "CT"
      | "DE"
      | "FL"
      | "GA"
      | "HI"
      | "IA"
      | "ID"
      | "IL"
      | "IN"
      | "KS"
      | "KY"
      | "LA"
      | "MA"
      | "MD"
      | "ME"
      | "MI"
      | "MN"
      | "MO"
      | "MS"
      | "MT"
      | "NC"
      | "ND"
      | "NE"
      | "NH"
      | "NJ"
      | "NM"
      | "NV"
      | "NY"
      | "OH"
      | "OK"
      | "OR"
      | "PA"
      | "RI"
      | "SC"
      | "SD"
      | "TN"
      | "TX"
      | "UT"
      | "VA"
      | "VT"
      | "WA"
      | "WI"
      | "WV"
      | "WY";
    /** @enum {string} */
    Gender: "M" | "F";
    HealthCareInformation: {
      diagnosisCode: string;
      diagnosisTypeCode: components["schemas"]["DiagnosisTypeCode"];
    };
    /** @enum {string} */
    DiagnosisTypeCode: "BK" | "ABK" | "BF" | "ABF";
    /** @enum {string} */
    IndividualRelationshipCode: "01" | "19" | "34";
    /** @enum {string} */
    RequestDependentProviderCode:
      | "AD"
      | "AT"
      | "BI"
      | "CO"
      | "CV"
      | "H"
      | "HH"
      | "LA"
      | "OT"
      | "P1"
      | "P2"
      | "PC"
      | "PE"
      | "R"
      | "RF"
      | "SK"
      | "SU";
    /** @enum {string} */
    RequestDependentReferenceIdentificationQualifier:
      | "9K"
      | "D3"
      | "EI"
      | "HPI"
      | "PXC"
      | "SY"
      | "TJ";
    Encounter: {
      beginningDateOfService?: string;
      dateOfService?: string;
      diagnosisCodePointer?: string[];
      endDateOfService?: string;
      industryCode?: components["schemas"]["IndustryCode"];
      medicalProcedures?: components["schemas"]["MedicalProcedure"][];
      priorAuthorizationOrReferralNumber?: string;
      procedureCode?: string;
      procedureModifiers?: string[];
      productOrServiceIDQualifier?: components["schemas"]["EncounterProductOrServiceIDQualifier"];
      referenceIdentificationQualifier?: components["schemas"]["EncounterReferenceIdentificationQualifier"];
      serviceTypeCodes?: components["schemas"]["RequestEligibilityServiceTypeCode"][];
    };
    /** @enum {string} */
    IndustryCode:
      | "01"
      | "02"
      | "03"
      | "04"
      | "05"
      | "06"
      | "07"
      | "08"
      | "09"
      | "10"
      | "11"
      | "12"
      | "13"
      | "14"
      | "15"
      | "16"
      | "17"
      | "18"
      | "19"
      | "20"
      | "21"
      | "22"
      | "23"
      | "24"
      | "25"
      | "26"
      | "31"
      | "32"
      | "33"
      | "34"
      | "41"
      | "42"
      | "49"
      | "50"
      | "51"
      | "52"
      | "53"
      | "54"
      | "55"
      | "56"
      | "57"
      | "58"
      | "60"
      | "61"
      | "62"
      | "65"
      | "71"
      | "72"
      | "81"
      | "99";
    MedicalProcedure: {
      diagnosisCodePointer?: string[];
      procedureCode: string;
      procedureModifiers?: string[];
      productOrServiceIDQualifier: components["schemas"]["MedicalProcedureProductOrServiceIDQualifier"];
    };
    /** @enum {string} */
    MedicalProcedureProductOrServiceIDQualifier: "AD" | "CJ" | "HC" | "ID" | "IV" | "N4" | "ZZ";
    /** @enum {string} */
    EncounterProductOrServiceIDQualifier: "AD" | "CJ" | "HC" | "ID" | "IV" | "N4" | "ZZ";
    /** @enum {string} */
    EncounterReferenceIdentificationQualifier: "9F" | "G1";
    /** @enum {string} */
    RequestEligibilityServiceTypeCode:
      | "1"
      | "2"
      | "3"
      | "4"
      | "5"
      | "6"
      | "7"
      | "8"
      | "9"
      | "10"
      | "11"
      | "12"
      | "13"
      | "14"
      | "15"
      | "16"
      | "17"
      | "18"
      | "19"
      | "20"
      | "21"
      | "22"
      | "23"
      | "24"
      | "25"
      | "26"
      | "27"
      | "28"
      | "30"
      | "32"
      | "33"
      | "34"
      | "35"
      | "36"
      | "37"
      | "38"
      | "39"
      | "40"
      | "41"
      | "42"
      | "43"
      | "44"
      | "45"
      | "46"
      | "47"
      | "48"
      | "49"
      | "50"
      | "51"
      | "52"
      | "53"
      | "54"
      | "55"
      | "56"
      | "57"
      | "58"
      | "59"
      | "60"
      | "61"
      | "62"
      | "63"
      | "64"
      | "65"
      | "66"
      | "67"
      | "68"
      | "69"
      | "70"
      | "71"
      | "72"
      | "73"
      | "74"
      | "75"
      | "76"
      | "77"
      | "78"
      | "79"
      | "80"
      | "81"
      | "82"
      | "83"
      | "84"
      | "85"
      | "86"
      | "87"
      | "88"
      | "89"
      | "90"
      | "91"
      | "92"
      | "93"
      | "94"
      | "95"
      | "96"
      | "97"
      | "98"
      | "99"
      | "A0"
      | "A1"
      | "A2"
      | "A3"
      | "A4"
      | "A5"
      | "A6"
      | "A7"
      | "A8"
      | "A9"
      | "AA"
      | "AB"
      | "AC"
      | "AD"
      | "AE"
      | "AF"
      | "AG"
      | "AH"
      | "AI"
      | "AJ"
      | "AK"
      | "AL"
      | "AM"
      | "AN"
      | "AO"
      | "AQ"
      | "AR"
      | "B1"
      | "B2"
      | "B3"
      | "BA"
      | "BB"
      | "BC"
      | "BD"
      | "BE"
      | "BF"
      | "BG"
      | "BH"
      | "BI"
      | "BJ"
      | "BK"
      | "BL"
      | "BM"
      | "BN"
      | "BP"
      | "BQ"
      | "BR"
      | "BS"
      | "BT"
      | "BU"
      | "BV"
      | "BW"
      | "BX"
      | "BY"
      | "BZ"
      | "C1"
      | "CA"
      | "CB"
      | "CC"
      | "CD"
      | "CE"
      | "CF"
      | "CG"
      | "CH"
      | "CI"
      | "CJ"
      | "CK"
      | "CL"
      | "CM"
      | "CN"
      | "CO"
      | "CP"
      | "CQ"
      | "DG"
      | "DM"
      | "DS"
      | "GF"
      | "GN"
      | "GY"
      | "IC"
      | "MH"
      | "NI"
      | "ON"
      | "PT"
      | "PU"
      | "RN"
      | "RT"
      | "TC"
      | "TN"
      | "UC";
    /** @deprecated */
    InformationReceiverName: {
      /** @deprecated */
      address?: components["schemas"]["RequestProviderAddress"];
      /** @deprecated */
      contactNumber?: string;
      /** @deprecated */
      contractNumber?: string;
      /** @deprecated */
      devicePinNumber?: string;
      /** @deprecated */
      facilityIdNumber?: string;
      /** @deprecated */
      facilityNetworkIdNumber?: string;
      /** @deprecated */
      federalTaxpayerIdentificationNumber?: string;
      /** @deprecated */
      informationReceiverAdditionalIdentifierState?: string;
      /** @deprecated */
      medicaidProviderNumber?: string;
      /** @deprecated */
      medicareProviderNumber?: string;
      /** @deprecated */
      nationalProviderIdentifier?: string;
      /** @deprecated */
      priorIdentifierNumber?: string;
      /** @deprecated */
      providerPlanNetworkIdNumber?: string;
      /** @deprecated */
      socialSecurityNumber?: string;
      /** @deprecated */
      stateLicenceNumber?: string;
      /** @deprecated */
      submitterIdNumber?: string;
    };
    RequestProviderAddress: {
      address1: string;
      address2?: string;
      city: string;
      countryCode?: string;
      countrySubDivisionCode?: string;
      postalCode?: string;
      state?: components["schemas"]["RequestStateOrProvinceCode"];
    };
    Provider: {
      address?: components["schemas"]["RequestProviderAddress"];
      /** @deprecated */
      contactNumber?: string;
      contractNumber?: string;
      devicePinNumber?: string;
      /** @deprecated */
      employersId?: string;
      facilityIdNumber?: string;
      facilityNetworkIdNumber?: string;
      firstName?: string;
      informationReceiverAdditionalIdentifierState?: string;
      lastName?: string;
      medicaidProviderNumber?: string;
      medicareProviderNumber?: string;
      npi?: string;
      organizationName?: string;
      payorId?: string;
      pharmacyProcessorNumber?: string;
      priorIdentifierNumber?: string;
      providerCode?: components["schemas"]["RequestProviderCode"];
      providerPlanNetworkIdNumber?: string;
      providerType?: components["schemas"]["ProviderType"];
      referenceIdentification?: string;
      serviceProviderNumber?: string;
      /** @deprecated */
      servicesPlanID?: string;
      ssn?: string;
      stateLicenceNumber?: string;
      submitterIdNumber?: string;
      taxId?: string;
    };
    /** @enum {string} */
    RequestProviderCode:
      | "AD"
      | "AT"
      | "BI"
      | "CO"
      | "CV"
      | "H"
      | "HH"
      | "LA"
      | "OT"
      | "P1"
      | "P2"
      | "PC"
      | "PE"
      | "R"
      | "RF"
      | "SB"
      | "SK"
      | "SU";
    /** @enum {string} */
    ProviderType:
      | "payer"
      | "third-party administrator"
      | "employer"
      | "hospital"
      | "facility"
      | "gateway provider"
      | "plan sponsor"
      | "provider";
    RequestSubscriber: {
      additionalIdentification?: components["schemas"]["AdditionalIdentificationSubscriber"];
      address?: components["schemas"]["RequestSubscriberAddress"];
      beginningCardIssueDate?: string;
      beginningPlanIssueDate?: string;
      birthSequenceNumber?: string;
      caseNumber?: string;
      coverageLevelCode?: string;
      dateOfBirth?: string;
      endCardIssueDate?: string;
      endPlanIssueDate?: string;
      firstName?: string;
      gender?: components["schemas"]["Gender"];
      groupNumber?: string;
      healthCareCodeInformation?: components["schemas"]["HealthCareInformation"][];
      idCard?: string;
      idCardIssueDate?: string;
      lastName?: string;
      medicaidRecipientIdentificationNumber?: string;
      memberId?: string;
      middleName?: string;
      planIssueDate?: string;
      providerCode?: components["schemas"]["RequestSubscriberProviderCode"];
      providerIdentifier?: string;
      referenceIdentificationQualifier?: components["schemas"]["RequestSubscriberReferenceIdentificationQualifier"];
      spendDownAmount?: string;
      spendDownTotalBilledAmount?: string;
      ssn?: string;
      suffix?: string;
    };
    AdditionalIdentificationSubscriber: {
      agencyClaimNumber?: string;
      contractNumber?: string;
      healthInsuranceClaimNumber?: string;
      identificationCardSerialNumber?: string;
      insurancePolicyNumber?: string;
      medicalRecordIdentificationNumber?: string;
      memberIdentificationNumber?: string;
      patientAccountNumber?: string;
      planNetworkIdentificationNumber?: string;
      planNumber?: string;
      policyNumber?: string;
    };
    RequestSubscriberAddress: {
      address1?: string;
      address2?: string;
      city?: string;
      countryCode?: string;
      countrySubDivisionCode?: string;
      postalCode?: string;
      state?: components["schemas"]["RequestStateOrProvinceCode"];
    };
    /** @enum {string} */
    RequestSubscriberProviderCode:
      | "AD"
      | "AT"
      | "BI"
      | "CO"
      | "CV"
      | "H"
      | "HH"
      | "LA"
      | "OT"
      | "P1"
      | "P2"
      | "PC"
      | "PE"
      | "R"
      | "RF"
      | "SK"
      | "SU";
    /** @enum {string} */
    RequestSubscriberReferenceIdentificationQualifier:
      | "9K"
      | "D3"
      | "EI"
      | "HPI"
      | "PXC"
      | "SY"
      | "TJ";
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
