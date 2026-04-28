import { randomUUID } from "node:crypto";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import { aesDecrypt, aesEncrypt } from "@/services/bank/anumati/AnumatiCrypto.js";
import { AnumatiClient } from "@/services/bank/anumati/AnumatiClient.js";
import type { IBankConnectionService, InitiateConsentResult, FetchFiResult } from "@/services/bank/anumati/IBankConnectionService.js";
import { BANK_AA_URL_PATHS, aaCallbackUrl } from "@/integrations/urls/bankAaUrls.js";
import { env } from "@/config/env.js";
import { BANK_ACCOUNT_STATUS } from "@/types/bankAccount.js";
import type { UUID } from "@/types/uuid.js";

export class AnumatiBankConnectionService implements IBankConnectionService {
  private readonly client: AnumatiClient;
  private readonly webviewUrl: string;
  private readonly callbackBaseUrl: string;
  private readonly aesKeyHex: string;

  constructor() {
    this.client = new AnumatiClient({
      entityId: env.ANUMATI_ENTITY_ID,
      apiKey: env.ANUMATI_API_KEY,
      privateKeyPem: env.ANUMATI_JWS_PRIVATE_KEY,
      baseUrl: env.ANUMATI_AA_BASE_URL
    });
    this.webviewUrl = env.ANUMATI_WEBVIEW_URL;
    this.callbackBaseUrl = env.ANUMATI_CALLBACK_BASE_URL;
    this.aesKeyHex = env.ANUMATI_AES_KEY;
  }

  async initiateConsent(params: {
    tenantId: UUID;
    userId: UUID;
    aaAddress: string;
    displayName: string;
    bankAccountId: string;
  }): Promise<InitiateConsentResult> {
    const sessionId = randomUUID();
    const callbackUrl = aaCallbackUrl(this.callbackBaseUrl, sessionId);

    const result = await this.client.post<{ consentHandle: string }>(BANK_AA_URL_PATHS.consent, {
      aaAddress: params.aaAddress,
      redirectUrl: callbackUrl,
      purpose: "Invoice reconciliation"
    });

    const { encrypted, iv } = aesEncrypt(JSON.stringify({ sessionId, bankAccountId: params.bankAccountId }), this.aesKeyHex);

    const redirectUrl = `${this.webviewUrl}?ecres=${encrypted}&iv=${iv}&sessionId=${sessionId}`;

    await BankAccountModel.findByIdAndUpdate(params.bankAccountId, {
      sessionId,
      consentHandle: result.consentHandle,
      status: BANK_ACCOUNT_STATUS.PENDING_CONSENT
    });

    return { redirectUrl, sessionId, consentHandle: result.consentHandle };
  }

  async handleConsentCallback(params: { sessionId: string; success: boolean; ecres?: string; iv?: string }): Promise<void> {
    const account = await BankAccountModel.findOne({ sessionId: params.sessionId });
    if (!account) return;

    if (!params.success) {
      account.status = BANK_ACCOUNT_STATUS.ERROR;
      account.lastErrorReason = "User denied or cancelled consent.";
      await account.save();
      return;
    }

    if (params.ecres && params.iv) {
      try {
        const decrypted = aesDecrypt(params.ecres, params.iv, this.aesKeyHex);
        const payload = JSON.parse(decrypted) as { consentId?: string };
        if (payload.consentId) {
          account.consentId = payload.consentId;
        }
      } catch {
        account.status = BANK_ACCOUNT_STATUS.ERROR;
        account.lastErrorReason = "Failed to decrypt consent callback params.";
        await account.save();
        return;
      }
    }

    account.status = BANK_ACCOUNT_STATUS.ACTIVE;
    await account.save();
  }

  async handleConsentNotify(payload: unknown): Promise<void> {
    const p = payload as Record<string, unknown>;
    const consentHandle = typeof p.consentHandle === "string" ? p.consentHandle : "";
    const status = typeof p.status === "string" ? p.status : "";
    if (!consentHandle) return;

    const account = await BankAccountModel.findOne({ consentHandle });
    if (!account) return;

    if (status === "ACTIVE") {
      account.status = BANK_ACCOUNT_STATUS.ACTIVE;
      account.consentId = typeof p.consentId === "string" ? p.consentId : account.consentId;
    } else if (status === "REVOKED") {
      account.status = BANK_ACCOUNT_STATUS.REVOKED;
    } else if (status === "EXPIRED") {
      account.status = BANK_ACCOUNT_STATUS.EXPIRED;
    } else if (status === "PAUSED") {
      account.status = BANK_ACCOUNT_STATUS.PAUSED;
    }
    await account.save();
  }

  async handleFiNotify(payload: unknown): Promise<void> {
    const p = payload as Record<string, unknown>;
    const consentId = typeof p.consentId === "string" ? p.consentId : "";
    const fiSessionId = typeof p.fiSessionId === "string" ? p.fiSessionId : "";
    if (!consentId) return;

    await BankAccountModel.findOneAndUpdate({ consentId }, { fiSessionId });
  }

  async fetchFiData(bankAccountId: string): Promise<FetchFiResult> {
    const account = await BankAccountModel.findById(bankAccountId);
    if (!account || !account.consentId) {
      throw new Error("No active consent for this bank account.");
    }

    const result = await this.client.post<{
      bankName?: string;
      maskedAccNumber?: string;
      balanceMinor?: number;
    }>(BANK_AA_URL_PATHS.fiFetch, { consentId: account.consentId });

    const balanceMinor = result.balanceMinor ?? 0;
    const balanceFetchedAt = new Date();

    account.balanceMinor = balanceMinor;
    account.bankName = result.bankName ?? account.bankName;
    account.maskedAccNumber = result.maskedAccNumber ?? account.maskedAccNumber;
    account.balanceFetchedAt = balanceFetchedAt;
    await account.save();

    return {
      balanceMinor,
      bankName: result.bankName,
      maskedAccNumber: result.maskedAccNumber,
      balanceFetchedAt
    };
  }

  async revokeConsent(bankAccountId: string): Promise<void> {
    const account = await BankAccountModel.findById(bankAccountId);
    if (!account) return;

    if (account.consentId) {
      await this.client.post(BANK_AA_URL_PATHS.consentRevoke, { consentId: account.consentId }).catch(() => {});
    }

    account.status = BANK_ACCOUNT_STATUS.REVOKED;
    await account.save();
  }
}
