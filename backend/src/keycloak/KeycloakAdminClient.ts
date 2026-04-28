import axios, { type AxiosInstance } from "axios";
import { KEYCLOAK_URL_PATHS } from "@/integrations/urls/keycloakUrls.js";

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export class KeycloakAdminClient {
  private readonly http: AxiosInstance;
  private tokenCache: TokenCache | null = null;

  constructor(
    baseUrl: string,
    private readonly realm: string,
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
      validateStatus: () => true
    });
  }

  async createUser(email: string, password: string, temporary: boolean): Promise<string> {
    const token = await this.getAdminToken();
    const body: Record<string, unknown> = {
      username: email,
      email,
      enabled: true,
      emailVerified: true,
      firstName: email.split("@")[0],
      lastName: "User"
    };
    if (password) {
      body.credentials = [{ type: "password", value: password, temporary }];
    }
    const response = await this.http.post(
      KEYCLOAK_URL_PATHS.adminUsers(this.realm),
      body,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (response.status !== 201) {
      throw new Error(`Keycloak createUser failed with HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    }
    const location = response.headers.location as string | undefined;
    if (!location) {
      throw new Error("Keycloak createUser response missing Location header.");
    }
    const userId = location.split("/").pop();
    if (!userId) {
      throw new Error("Keycloak createUser: cannot parse user ID from Location header.");
    }
    return userId;
  }

  async setPassword(kcUserId: string, password: string, temporary: boolean): Promise<void> {
    const token = await this.getAdminToken();
    const response = await this.http.put(
      KEYCLOAK_URL_PATHS.adminUserResetPassword(this.realm, kcUserId),
      { type: "password", value: password, temporary },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (response.status !== 204) {
      throw new Error(`Keycloak setPassword failed with HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    }
  }

  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    const token = await this.getAdminToken();
    const response = await this.http.get(
      KEYCLOAK_URL_PATHS.adminUsers(this.realm),
      {
        params: { email, exact: true },
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (response.status !== 200) {
      throw new Error(`Keycloak findUserByEmail failed with HTTP ${response.status}`);
    }
    const users = Array.isArray(response.data) ? (response.data as Array<{ id: string }>) : [];
    return users.length > 0 ? { id: users[0].id } : null;
  }

  async userExists(email: string): Promise<boolean> {
    const user = await this.findUserByEmail(email);
    return user !== null;
  }

  async deleteUser(kcUserId: string): Promise<void> {
    const token = await this.getAdminToken();
    const response = await this.http.delete(
      KEYCLOAK_URL_PATHS.adminUserById(this.realm, kcUserId),
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (response.status !== 204) {
      throw new Error(`Keycloak deleteUser failed with HTTP ${response.status}`);
    }
  }

  async executeActionsEmail(kcUserId: string, actions: string[]): Promise<void> {
    const token = await this.getAdminToken();
    const response = await this.http.put(
      KEYCLOAK_URL_PATHS.adminUserExecuteActionsEmail(this.realm, kcUserId),
      actions,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );
    if (response.status !== 204) {
      throw new Error(`Keycloak executeActionsEmail failed with HTTP ${response.status}: ${JSON.stringify(response.data)}`);
    }
  }

  private async getAdminToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const response = await this.http.post(
      KEYCLOAK_URL_PATHS.openIdConnectToken(this.realm),
      body.toString(),
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      }
    );

    if (response.status !== 200) {
      throw new Error(`Keycloak admin token request failed with HTTP ${response.status}`);
    }

    const data = response.data as { access_token?: unknown; expires_in?: unknown };
    const accessToken = typeof data.access_token === "string" ? data.access_token : "";
    if (!accessToken) {
      throw new Error("Keycloak admin token response missing access_token.");
    }

    const expiresIn = typeof data.expires_in === "number" ? data.expires_in * 1000 : TOKEN_TTL_MS;
    this.tokenCache = {
      accessToken,
      expiresAt: Date.now() + Math.min(expiresIn, TOKEN_TTL_MS)
    };

    return accessToken;
  }
}
