import type { Express } from "express";
import { Types } from "mongoose";
import { createApp } from "@/app.js";
import type { AuthService } from "@/auth/AuthService.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";
import type { TenantRole } from "@/models/core/TenantUserRole.js";
import { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import { EmailSimulationService } from "@/services/platform/emailSimulationService.js";
import { ExportService } from "@/services/export/exportService.js";
import { IngestionService } from "@/services/ingestion/ingestionService.js";
import { InvoiceService } from "@/services/invoice/invoiceService.js";
import { MailboxAssignmentsAdminService } from "@/services/tenant/mailboxAssignmentsAdminService.js";
import { MockBankConnectionService } from "@/services/bank/anumati/MockBankConnectionService.js";
import { MockOcrProvider } from "@/ai/ocr/MockOcrProvider.js";
import { NoopFieldVerifier } from "@/ai/verifiers/NoopFieldVerifier.js";
import { TallyExporter } from "@/services/export/tallyExporter.js";
import { TenantAdminService } from "@/services/tenant/tenantAdminService.js";
import { TriageService } from "@/services/invoice/triageService.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { ONBOARDING_STATUS } from "@/types/onboarding.js";
import { toUUID, type UUID } from "@/types/uuid.js";

const DEFAULT_TENANT_ID = toUUID("11111111-1111-1111-1111-111111111111");
const DEFAULT_USER_ID = toUUID("22222222-2222-2222-2222-222222222222");
export const TEST_USER_EMAIL = "harness@ledgerbuddy.test";
export const TEST_BEARER_TOKEN = "harness-token";

interface AuthOverrides {
  tenantId?: UUID;
  userId?: UUID;
  email?: string;
  role?: TenantRole;
  isPlatformAdmin?: boolean;
}

function buildAuthContext(overrides: AuthOverrides = {}): AuthenticatedRequestContext {
  return {
    userId: overrides.userId ?? DEFAULT_USER_ID,
    email: overrides.email ?? TEST_USER_EMAIL,
    tenantId: overrides.tenantId ?? DEFAULT_TENANT_ID,
    tenantName: "Harness Tenant",
    onboardingStatus: ONBOARDING_STATUS.COMPLETED,
    role: (overrides.role ?? "TENANT_ADMIN") satisfies TenantRole,
    isPlatformAdmin: overrides.isPlatformAdmin ?? false
  };
}

function buildStubAuthService(authContext: AuthenticatedRequestContext): AuthService {
  return {
    resolveRequestContext: async () => authContext
  } as unknown as AuthService;
}

function buildStubExportService(): ExportService {
  const exporter = new TallyExporter({
    endpoint: "http://tally.test.local",
    companyName: "Test Co",
    purchaseLedgerName: "Purchases",
    gstLedgers: { cgstLedger: "CGST", sgstLedger: "SGST", igstLedger: "IGST", cessLedger: "Cess" }
  });
  return new ExportService(exporter);
}

export interface IntegrationAppContext {
  app: Express;
  tenantId: string;
  clientOrgId: Types.ObjectId;
  bearerToken: string;
}

export async function createIntegrationApp(overrides: AuthOverrides = {}): Promise<IntegrationAppContext> {
  const authContext = buildAuthContext(overrides);

  const clientOrg = await ClientOrganizationModel.create({
    tenantId: authContext.tenantId,
    gstin: "29ABCDE1234F1Z5",
    companyName: "Harness Test ClientOrg"
  });

  const ocrProvider = new MockOcrProvider({ text: "mock", confidence: 0.9 });
  const ingestionService = new IngestionService([], ocrProvider);
  const approvalWorkflowService = new ApprovalWorkflowService();
  const invoiceService = new InvoiceService({ workflowService: approvalWorkflowService });

  const app = await createApp({
    ingestionService,
    invoiceService,
    exportService: buildStubExportService(),
    emailSimulationService: new EmailSimulationService(),
    authService: buildStubAuthService(authContext),
    tenantAdminService: new TenantAdminService(),
    tenantInviteService: {} as never,
    clientOrgsAdminService: new ClientOrgsAdminService(),
    mailboxAssignmentsAdminService: new MailboxAssignmentsAdminService(),
    platformAdminService: {} as never,
    gmailIntegrationService: {} as never,
    notificationService: {} as never,
    bankService: new MockBankConnectionService(),
    fileStore: {} as never,
    keycloakAdmin: {} as never,
    approvalWorkflowService,
    triageService: new TriageService(),
    ocrProvider,
    fieldVerifier: new NoopFieldVerifier()
  });

  return {
    app,
    tenantId: authContext.tenantId,
    clientOrgId: clientOrg._id,
    bearerToken: TEST_BEARER_TOKEN
  };
}
