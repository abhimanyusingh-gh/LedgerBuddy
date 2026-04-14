export interface InitiateConsentResult {
  redirectUrl: string;
  sessionId: string;
  consentHandle?: string;
}

export interface FetchFiResult {
  balanceMinor: number;
  bankName?: string;
  maskedAccNumber?: string;
  balanceFetchedAt: Date;
}

export interface IBankConnectionService {
  initiateConsent(params: {
    tenantId: string;
    userId: string;
    aaAddress: string;
    displayName: string;
    bankAccountId: string;
  }): Promise<InitiateConsentResult>;

  handleConsentCallback(params: {
    sessionId: string;
    success: boolean;
    ecres?: string;
    iv?: string;
  }): Promise<void>;

  handleConsentNotify(payload: unknown): Promise<void>;

  handleFiNotify(payload: unknown): Promise<void>;

  fetchFiData(bankAccountId: string): Promise<FetchFiResult>;

  revokeConsent(bankAccountId: string): Promise<void>;
}
