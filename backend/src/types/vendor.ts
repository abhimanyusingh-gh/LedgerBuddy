export const VENDOR_STATUS = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  BLOCKED: "blocked"
} as const;

export type VendorStatus = (typeof VENDOR_STATUS)[keyof typeof VENDOR_STATUS];

export const VendorStatuses = Object.values(VENDOR_STATUS);

export const DEDUCTEE_TYPE = {
  INDIVIDUAL_HUF: "individual_huf",
  COMPANY: "company",
  FIRM: "firm",
  LLP: "llp",
  AOP_BOI: "aop_boi",
  LOCAL_AUTHORITY: "local_authority",
  ARTIFICIAL_JURIDICAL_PERSON: "artificial_juridical_person",
  COOPERATIVE_SOCIETY: "cooperative_society",
  GOVERNMENT: "government"
} as const;

export type DeducteeType = (typeof DEDUCTEE_TYPE)[keyof typeof DEDUCTEE_TYPE];

export const DeducteeTypes = Object.values(DEDUCTEE_TYPE);

export const MSME_CLASSIFICATION_SOURCE = {
  USER_INPUT: "user_input",
  UDYAM_PORTAL: "udyam_portal",
  VENDOR_DECLARATION: "vendor_declaration",
  SYSTEM_DERIVED: "system_derived"
} as const;

export type MsmeClassificationSource = (typeof MSME_CLASSIFICATION_SOURCE)[keyof typeof MSME_CLASSIFICATION_SOURCE];

export const MsmeClassificationSources = Object.values(MSME_CLASSIFICATION_SOURCE);

export const MSME_CLASSIFICATION = {
  MICRO: "micro",
  SMALL: "small",
  MEDIUM: "medium"
} as const;

export type MsmeClassification = (typeof MSME_CLASSIFICATION)[keyof typeof MSME_CLASSIFICATION];

export const MsmeClassifications = Object.values(MSME_CLASSIFICATION);
