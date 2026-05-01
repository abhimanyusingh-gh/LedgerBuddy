import mongoose from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { VENDOR_STATUS, VendorStatuses, DEDUCTEE_TYPE, DeducteeTypes, MSME_CLASSIFICATION_SOURCE } from "@/types/vendor.js";

describe("VendorMaster schema additive fields", () => {
  it("vendorStatus enum mirrors VENDOR_STATUS const object", () => {
    const enumValues = (VendorMasterModel.schema.paths.vendorStatus as unknown as { enumValues: string[] }).enumValues;
    expect(enumValues).toEqual(expect.arrayContaining(VendorStatuses));
    expect(VendorStatuses).toEqual(expect.arrayContaining(Object.values(VENDOR_STATUS)));
  });

  it("vendorStatus defaults to active and is required", () => {
    const path = VendorMasterModel.schema.paths.vendorStatus as unknown as {
      isRequired: boolean;
      defaultValue: string;
    };
    expect(path.isRequired).toBe(true);
    expect(path.defaultValue).toBe(VENDOR_STATUS.ACTIVE);
  });

  it("tallyLedgerGroup defaults to 'Sundry Creditors'", () => {
    const path = VendorMasterModel.schema.paths.tallyLedgerGroup as unknown as {
      defaultValue: string;
      isRequired: boolean;
    };
    expect(path.defaultValue).toBe("Sundry Creditors");
    expect(path.isRequired).toBe(true);
  });

  it("tallyLedgerName, tallyLedgerGuid, stateCode, stateName default to null", () => {
    const paths = VendorMasterModel.schema.paths as Record<string, { defaultValue?: unknown }>;
    expect(paths.tallyLedgerName.defaultValue).toBeNull();
    expect(paths.tallyLedgerGuid.defaultValue).toBeNull();
    expect(paths.stateCode.defaultValue).toBeNull();
    expect(paths.stateName.defaultValue).toBeNull();
  });

  it("deducteeType enum includes every DEDUCTEE_TYPE value plus null", () => {
    const enumValues = (VendorMasterModel.schema.paths.deducteeType as unknown as { enumValues: Array<string | null> }).enumValues;
    for (const value of Object.values(DEDUCTEE_TYPE)) {
      expect(enumValues).toContain(value);
    }
    expect(enumValues).toContain(null);
    expect(DeducteeTypes).toEqual(Object.values(DEDUCTEE_TYPE));
  });

  it("msmeClassificationHistory is an array of sub-documents with the four required fields", () => {
    const arrayPath = VendorMasterModel.schema.paths.msmeClassificationHistory as unknown as {
      schema: mongoose.Schema;
    };
    const subPaths = arrayPath.schema.paths;
    expect(subPaths.classification).toBeDefined();
    expect(subPaths.validFrom).toBeDefined();
    expect(subPaths.validTo).toBeDefined();
    expect(subPaths.source).toBeDefined();
  });
});

describeHarness("VendorMaster lowerDeductionCert validators (D-013)", ({ getHarness }) => {
  let clientOrgId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await VendorMasterModel.syncIndexes();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  beforeEach(async () => {
    const org = await ClientOrganizationModel.create({
      tenantId: "tenant-261",
      companyName: "ACME",
      gstin: "29ABCDE1234F1Z5"
    });
    clientOrgId = org._id;
  });

  function buildVendorPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tenantId: "tenant-261",
      clientOrgId,
      vendorFingerprint: "vf-1",
      name: "Vendor One",
      lastInvoiceDate: new Date("2026-01-01"),
      ...overrides
    };
  }

  it("creates a vendor with default vendorStatus=active and tallyLedgerGroup=Sundry Creditors when fields omitted", async () => {
    const vendor = await VendorMasterModel.create(buildVendorPayload());
    expect(vendor.vendorStatus).toBe(VENDOR_STATUS.ACTIVE);
    expect(vendor.tallyLedgerGroup).toBe("Sundry Creditors");
    expect(vendor.tallyLedgerName).toBeNull();
    expect(vendor.tallyLedgerGuid).toBeNull();
    expect(vendor.lowerDeductionCert).toBeNull();
    expect(vendor.deducteeType).toBeNull();
    expect(vendor.msmeClassificationHistory).toEqual([]);
  });

  it("rejects lowerDeductionCert when validTo precedes validFrom", async () => {
    await expect(
      VendorMasterModel.create(
        buildVendorPayload({
          lowerDeductionCert: {
            certificateNumber: "CERT-197-A",
            validFrom: new Date("2026-04-01"),
            validTo: new Date("2026-03-31"),
            maxAmountMinor: 1_000_000,
            applicableRateBps: 500
          }
        })
      )
    ).rejects.toThrow(/validTo must be on or after validFrom/);
  });

  it("accepts lowerDeductionCert when validTo equals validFrom", async () => {
    const sameDay = new Date("2026-04-01");
    const vendor = await VendorMasterModel.create(
      buildVendorPayload({
        vendorFingerprint: "vf-equal",
        lowerDeductionCert: {
          certificateNumber: "CERT-EQ",
          validFrom: sameDay,
          validTo: sameDay,
          maxAmountMinor: 500_000,
          applicableRateBps: 200
        }
      })
    );
    expect(vendor.lowerDeductionCert?.certificateNumber).toBe("CERT-EQ");
  });

  it("accepts lowerDeductionCert when validTo is after validFrom", async () => {
    const vendor = await VendorMasterModel.create(
      buildVendorPayload({
        vendorFingerprint: "vf-ok",
        lowerDeductionCert: {
          certificateNumber: "CERT-OK",
          validFrom: new Date("2026-04-01"),
          validTo: new Date("2027-03-31"),
          maxAmountMinor: 10_000_000,
          applicableRateBps: 100
        }
      })
    );
    expect(vendor.lowerDeductionCert?.maxAmountMinor).toBe(10_000_000);
    expect(vendor.lowerDeductionCert?.applicableRateBps).toBe(100);
  });

  it("legacy vendor read returns the new fields with their null/default values (additive contract)", async () => {
    await VendorMasterModel.collection.insertOne({
      tenantId: "tenant-261",
      clientOrgId,
      vendorFingerprint: "vf-legacy",
      name: "Legacy Vendor",
      aliases: [],
      pan: null,
      gstin: null,
      panCategory: null,
      defaultGlCode: null,
      defaultCostCenter: null,
      defaultTdsSection: null,
      bankHistory: [],
      msme: { udyamNumber: null, classification: null, verifiedAt: null, agreedPaymentDays: null },
      emailDomains: [],
      invoiceCount: 0,
      lastInvoiceDate: new Date("2026-01-01"),
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const fetched = await VendorMasterModel.findOne({ vendorFingerprint: "vf-legacy" }).lean();
    expect(fetched).toBeTruthy();
    expect(fetched!.tallyLedgerName ?? null).toBeNull();
    expect(fetched!.tallyLedgerGroup ?? "Sundry Creditors").toBe("Sundry Creditors");
    expect(fetched!.tallyLedgerGuid ?? null).toBeNull();
    expect(fetched!.vendorStatus ?? VENDOR_STATUS.ACTIVE).toBe(VENDOR_STATUS.ACTIVE);
    expect(fetched!.stateCode ?? null).toBeNull();
    expect(fetched!.stateName ?? null).toBeNull();
    expect(fetched!.lowerDeductionCert ?? null).toBeNull();
    expect(fetched!.deducteeType ?? null).toBeNull();
    expect(fetched!.msmeClassificationHistory ?? []).toEqual([]);
  });

  it("accepts a multi-entry msmeClassificationHistory with required source enum value", async () => {
    const vendor = await VendorMasterModel.create(
      buildVendorPayload({
        vendorFingerprint: "vf-msme",
        msmeClassificationHistory: [
          {
            classification: "micro",
            validFrom: new Date("2025-04-01"),
            validTo: new Date("2026-03-31"),
            source: MSME_CLASSIFICATION_SOURCE.UDYAM_PORTAL
          },
          {
            classification: "small",
            validFrom: new Date("2026-04-01"),
            validTo: null,
            source: MSME_CLASSIFICATION_SOURCE.VENDOR_DECLARATION
          }
        ]
      })
    );
    expect(vendor.msmeClassificationHistory).toHaveLength(2);
    expect(vendor.msmeClassificationHistory[0].source).toBe("udyam_portal");
    expect(vendor.msmeClassificationHistory[1].validTo).toBeNull();
  });
});
