import { TdsRateTableModel } from "../models/compliance/TdsRateTable.js";
import { TdsSectionMappingModel } from "../models/compliance/TdsSectionMapping.js";
import { logger } from "../utils/logger.js";

const FY2025_START = new Date("2025-04-01T00:00:00.000Z");

const TDS_RATES = [
  {
    section: "194C",
    description: "Payment to Contractors",
    rateCompanyBps: 200,
    rateIndividualBps: 100,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 3000000,
    thresholdAnnualMinor: 10000000
  },
  {
    section: "194J",
    description: "Professional / Technical Services",
    rateCompanyBps: 1000,
    rateIndividualBps: 1000,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 3000000,
    thresholdAnnualMinor: 0
  },
  {
    section: "194H",
    description: "Commission / Brokerage",
    rateCompanyBps: 500,
    rateIndividualBps: 500,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 1500000,
    thresholdAnnualMinor: 0
  },
  {
    section: "194I(a)",
    description: "Rent — Plant and Machinery",
    rateCompanyBps: 200,
    rateIndividualBps: 200,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 0,
    thresholdAnnualMinor: 24000000
  },
  {
    section: "194I(b)",
    description: "Rent — Land and Building",
    rateCompanyBps: 1000,
    rateIndividualBps: 1000,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 0,
    thresholdAnnualMinor: 24000000
  },
  {
    section: "194Q",
    description: "Purchase of Goods",
    rateCompanyBps: 10,
    rateIndividualBps: 10,
    rateNoPanBps: 500,
    thresholdSingleMinor: 0,
    thresholdAnnualMinor: 5000000000
  },
  {
    section: "194A",
    description: "Interest other than on Securities",
    rateCompanyBps: 1000,
    rateIndividualBps: 1000,
    rateNoPanBps: 2000,
    thresholdSingleMinor: 0,
    thresholdAnnualMinor: 5000000
  }
];

const SECTION_MAPPINGS = [
  { glCategory: "Professional Services", panCategory: "*", tdsSection: "194J", priority: 10 },
  { glCategory: "Contractor Services", panCategory: "C", tdsSection: "194C", priority: 10 },
  { glCategory: "Contractor Services", panCategory: "P", tdsSection: "194C", priority: 10 },
  { glCategory: "Contractor Services", panCategory: "*", tdsSection: "194C", priority: 5 },
  { glCategory: "Rent - Building", panCategory: "*", tdsSection: "194I(b)", priority: 10 },
  { glCategory: "Rent - Machinery", panCategory: "*", tdsSection: "194I(a)", priority: 10 },
  { glCategory: "Commission", panCategory: "*", tdsSection: "194H", priority: 10 },
  { glCategory: "Interest", panCategory: "*", tdsSection: "194A", priority: 10 },
  { glCategory: "Raw Materials", panCategory: "*", tdsSection: "194Q", priority: 10 },
  { glCategory: "Rent", panCategory: "*", tdsSection: "194I(b)", priority: 5 },
  { glCategory: "Software Subscription", panCategory: "*", tdsSection: "194J", priority: 10 },
  { glCategory: "Repairs & Maintenance", panCategory: "*", tdsSection: "194C", priority: 5 },
  { glCategory: "Marketing", panCategory: "*", tdsSection: "194C", priority: 5 }
];

export async function seedTdsRates(): Promise<void> {
  let ratesUpserted = 0;
  for (const rate of TDS_RATES) {
    await TdsRateTableModel.findOneAndUpdate(
      { section: rate.section, effectiveFrom: FY2025_START },
      { ...rate, effectiveFrom: FY2025_START, effectiveTo: null, isActive: true },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    ratesUpserted++;
  }

  let mappingsUpserted = 0;
  for (const mapping of SECTION_MAPPINGS) {
    await TdsSectionMappingModel.findOneAndUpdate(
      { tenantId: null, glCategory: mapping.glCategory, panCategory: mapping.panCategory },
      { ...mapping, tenantId: null },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    mappingsUpserted++;
  }

  logger.info("tds.seed.complete", { ratesUpserted, mappingsUpserted });
}
