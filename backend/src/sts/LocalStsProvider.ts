import { HttpStsProvider } from "./HttpStsProvider.js";

interface LocalStsProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  validateUrl: string;
  userInfoUrl: string;
  timeoutMs: number;
}

export class LocalStsProvider extends HttpStsProvider {
  constructor(config: LocalStsProviderConfig) {
    super({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authUrl: config.authUrl,
      tokenUrl: config.tokenUrl,
      validateUrl: config.validateUrl,
      userInfoUrl: config.userInfoUrl,
      timeoutMs: config.timeoutMs
    });
  }
}
