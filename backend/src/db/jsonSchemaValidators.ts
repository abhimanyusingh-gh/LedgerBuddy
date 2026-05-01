type MinorFieldPath = string;

interface MinorFieldGroup {
  prefix: string;
  fields: MinorFieldPath[];
  nullable?: boolean;
  array?: boolean;
}

interface CollectionValidatorSpec {
  modelName: string;
  groups: MinorFieldGroup[];
}

export const MINOR_FIELD_REGISTRY: readonly CollectionValidatorSpec[] = [
  {
    modelName: "Invoice",
    groups: [
      { prefix: "", fields: ["invoiceAmountMinor"], nullable: true },
      {
        prefix: "parsed",
        fields: ["totalAmountMinor"],
        nullable: true
      },
      {
        prefix: "parsed.gst",
        fields: ["subtotalMinor", "cgstMinor", "sgstMinor", "igstMinor", "cessMinor", "totalTaxMinor"],
        nullable: true
      },
      {
        prefix: "parsed.lineItems",
        fields: ["amountMinor", "cgstMinor", "sgstMinor", "igstMinor"],
        nullable: true,
        array: true
      },
      {
        prefix: "compliance.tds",
        fields: ["amountMinor", "netPayableMinor", "taxableBaseMinor"],
        nullable: true
      },
      {
        prefix: "compliance.tcs",
        fields: ["amountMinor"],
        nullable: true
      },
      {
        prefix: "workflowState.stepResults",
        fields: ["invoiceAmountMinor"],
        nullable: true,
        array: true
      }
    ]
  },
  {
    modelName: "BankAccount",
    groups: [{ prefix: "", fields: ["balanceMinor"], nullable: true }]
  },
  {
    modelName: "BankTransaction",
    groups: [{ prefix: "", fields: ["debitMinor", "creditMinor", "balanceMinor"], nullable: true }]
  },
  {
    modelName: "TenantUserRole",
    groups: [{ prefix: "capabilities", fields: ["approvalLimitMinor"], nullable: true }]
  },
  {
    modelName: "ClientComplianceConfig",
    groups: [
      {
        prefix: "",
        fields: ["maxInvoiceTotalMinor", "eInvoiceThresholdMinor", "minimumExpectedTotalMinor", "reconciliationAmountToleranceMinor"],
        nullable: true
      }
    ]
  },
  {
    modelName: "TdsRateTable",
    groups: [{ prefix: "", fields: ["thresholdSingleMinor", "thresholdAnnualMinor"], nullable: false }]
  },
  {
    modelName: "TdsVendorLedger",
    groups: [
      { prefix: "", fields: ["cumulativeBaseMinor", "cumulativeTdsMinor"], nullable: false },
      {
        prefix: "entries",
        fields: ["taxableAmountMinor", "tdsAmountMinor"],
        nullable: false,
        array: true
      }
    ]
  },
  {
    modelName: "TdsVendorLedgerArchive",
    groups: [
      { prefix: "", fields: ["cumulativeBaseMinor", "cumulativeTdsMinor"], nullable: false },
      {
        prefix: "entries",
        fields: ["taxableAmountMinor", "tdsAmountMinor"],
        nullable: false,
        array: true
      }
    ]
  },
  {
    modelName: "TdsVendorLedgerEntryOverflow",
    groups: [
      {
        prefix: "entries",
        fields: ["taxableAmountMinor", "tdsAmountMinor"],
        nullable: false,
        array: true
      }
    ]
  },
  {
    modelName: "VendorMaster",
    groups: [
      {
        prefix: "lowerDeductionCert",
        fields: ["maxAmountMinor"],
        nullable: false
      }
    ]
  }
] as const;

const INTEGER_BSON_TYPES = ["int", "long", "double"] as const;

interface MinorFieldRule {
  bsonType: readonly string[];
  multipleOf: 1;
}

export function buildMinorFieldRule(nullable: boolean): MinorFieldRule {
  return {
    bsonType: nullable ? [...INTEGER_BSON_TYPES, "null"] : [...INTEGER_BSON_TYPES],
    multipleOf: 1
  };
}

export function buildCollectionJsonSchema(spec: CollectionValidatorSpec): Record<string, unknown> {
  const root: Record<string, unknown> = { bsonType: "object", properties: {} };
  const rootProps = root.properties as Record<string, unknown>;

  for (const group of spec.groups) {
    const fieldSchemas: Record<string, MinorFieldRule> = {};
    for (const field of group.fields) {
      fieldSchemas[field] = buildMinorFieldRule(group.nullable ?? false);
    }

    if (group.prefix === "") {
      Object.assign(rootProps, fieldSchemas);
      continue;
    }

    const segments = group.prefix.split(".");
    let cursor = rootProps;

    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i]!;
      const isLast = i === segments.length - 1;
      if (isLast) {
        if (group.array) {
          cursor[segment] = {
            bsonType: "array",
            items: { bsonType: "object", properties: fieldSchemas }
          };
        } else {
          const existing = (cursor[segment] as { properties?: Record<string, unknown> } | undefined) ?? {
            bsonType: "object",
            properties: {}
          };
          const merged = {
            bsonType: "object",
            properties: { ...(existing.properties ?? {}), ...fieldSchemas }
          };
          cursor[segment] = merged;
        }
      } else {
        const existing = (cursor[segment] as { properties?: Record<string, unknown> } | undefined) ?? {
          bsonType: "object",
          properties: {}
        };
        const next = {
          bsonType: "object",
          properties: { ...(existing.properties ?? {}) }
        };
        cursor[segment] = next;
        cursor = next.properties as Record<string, unknown>;
      }
    }
  }

  return root;
}

export function buildAllJsonSchemas(): Array<{ modelName: string; jsonSchema: Record<string, unknown> }> {
  return MINOR_FIELD_REGISTRY.map((spec) => ({
    modelName: spec.modelName,
    jsonSchema: buildCollectionJsonSchema(spec)
  }));
}
