import { randomUUID } from "node:crypto";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import type { IBankConnectionService, InitiateConsentResult, FetchFiResult } from "@/services/bank/anumati/IBankConnectionService.js";
import { BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";

const MOCK_BALANCE_MINOR = 12345600;
const MOCK_BANK_NAME = "Demo Bank";
const MOCK_MASKED_ACC = "XXXX1234";

export class MockBankConnectionService implements IBankConnectionService {
  async initiateConsent(params: {
    tenantId: string;
    userId: string;
    aaAddress: string;
    displayName: string;
    bankAccountId: string;
  }): Promise<InitiateConsentResult> {
    const sessionId = randomUUID();

    await BankAccountModel.findByIdAndUpdate(params.bankAccountId, {
      sessionId,
      consentHandle: `mock-handle-${sessionId}`,
      status: BANK_ACCOUNT_STATUS.PENDING_CONSENT
    });

    const redirectUrl = `/api/bank/mock-callback?sessionId=${sessionId}&success=true`;

    return { redirectUrl, sessionId };
  }

  async handleConsentCallback(params: { sessionId: string; success: boolean }): Promise<void> {
    const account = await BankAccountModel.findOne({ sessionId: params.sessionId });
    if (!account) return;

    if (!params.success) {
      account.status = BANK_ACCOUNT_STATUS.ERROR;
      account.lastErrorReason = "Mock consent denied.";
    } else {
      account.status = BANK_ACCOUNT_STATUS.ACTIVE;
      account.consentId = `mock-consent-${randomUUID()}`;
      account.bankName = MOCK_BANK_NAME;
      account.maskedAccNumber = MOCK_MASKED_ACC;
      account.balanceMinor = MOCK_BALANCE_MINOR;
      account.balanceFetchedAt = new Date();
    }

    await account.save();
  }

  async handleConsentNotify(_payload: unknown): Promise<void> {}

  async handleFiNotify(_payload: unknown): Promise<void> {}

  async fetchFiData(bankAccountId: string): Promise<FetchFiResult> {
    const balanceFetchedAt = new Date();

    await BankAccountModel.findByIdAndUpdate(bankAccountId, {
      balanceMinor: MOCK_BALANCE_MINOR,
      bankName: MOCK_BANK_NAME,
      maskedAccNumber: MOCK_MASKED_ACC,
      balanceFetchedAt
    });

    return {
      balanceMinor: MOCK_BALANCE_MINOR,
      bankName: MOCK_BANK_NAME,
      maskedAccNumber: MOCK_MASKED_ACC,
      balanceFetchedAt
    };
  }

  async revokeConsent(bankAccountId: string): Promise<void> {
    await BankAccountModel.findByIdAndUpdate(bankAccountId, { status: BANK_ACCOUNT_STATUS.REVOKED });
  }
}
