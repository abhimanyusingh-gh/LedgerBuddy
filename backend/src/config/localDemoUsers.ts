import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "@/config/env.js";
import { TenantRoles, type TenantRole } from "@/models/core/TenantUserRole.js";
import type { OnboardingStatus, TenantMode } from "@/types/onboarding.js";

const demoConfigSchema = z.object({
  tenants: z.array(
    z.object({
      id: z.string().length(24),
      name: z.string().min(1),
      onboardingStatus: z.enum(["pending", "completed"]).default("completed"),
      mode: z.enum(["test", "live"]).default("test")
    })
  ),
  users: z.array(
    z.object({
      email: z.string().email(),
      password: z.string().min(1),
      displayName: z.string().min(1),
      tenantId: z.string().length(24),
      role: z.enum(TenantRoles)
    })
  )
});

type DemoConfig = z.infer<typeof demoConfigSchema>;

interface LocalDemoTenant {
  id: string;
  name: string;
  onboardingStatus: OnboardingStatus;
  mode: TenantMode;
}

interface LocalDemoUser {
  email: string;
  password: string;
  displayName: string;
  tenantId: string;
  role: TenantRole;
}

interface LocalDemoUsersConfig {
  tenants: LocalDemoTenant[];
  users: LocalDemoUser[];
}

let cachedConfigPath = "";
let cachedConfig: LocalDemoUsersConfig | null = null;

export function loadLocalDemoUsersConfig(): LocalDemoUsersConfig {
  const configPath = resolveConfigPath(env.LOCAL_DEMO_CONFIG_PATH);
  if (!configPath) {
    return { tenants: [], users: [] };
  }

  if (cachedConfig && cachedConfigPath === configPath) {
    return cachedConfig;
  }

  if (!existsSync(configPath)) {
    throw new Error(`Local demo config file is missing: ${configPath}`);
  }

  const parsed = demoConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")) as DemoConfig);
  const normalizedTenants = parsed.tenants.map((tenant) => ({
    id: tenant.id,
    name: tenant.name.trim(),
    onboardingStatus: tenant.onboardingStatus,
    mode: tenant.mode
  }));
  const normalizedUsers = parsed.users.map((user) => ({
    email: user.email.trim().toLowerCase(),
    password: user.password,
    displayName: user.displayName.trim(),
    tenantId: user.tenantId,
    role: user.role
  }));

  cachedConfig = {
    tenants: normalizedTenants,
    users: normalizedUsers
  };
  cachedConfigPath = configPath;
  return cachedConfig;
}

function resolveConfigPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return "";
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}
