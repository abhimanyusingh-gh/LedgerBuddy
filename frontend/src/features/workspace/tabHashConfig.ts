import type { TenantViewTab } from "@/types";

export const TAB_HASH_PATH = {
  overview: "#/overview",
  dashboard: "#/invoices",
  exports: "#/exports",
  statements: "#/reconciliation",
  config: "#/settings",
  connections: "#/connections"
} as const satisfies Record<TenantViewTab, string>;

export const HASH_TO_TAB: Record<string, TenantViewTab> = Object.entries(TAB_HASH_PATH).reduce(
  (acc, [tab, hash]) => {
    acc[hash] = tab as TenantViewTab;
    return acc;
  },
  {} as Record<string, TenantViewTab>
);

export const LEGACY_QUERY_TABS = Object.keys(TAB_HASH_PATH) as TenantViewTab[];

export const STANDALONE_HASH_PATH = {
  triage: "#/triage",
  mailboxes: "#/mailboxes",
  reportsTds: "#/reports/tds",
  vendors: "#/vendors"
} as const;

export type StandaloneHashRoute = keyof typeof STANDALONE_HASH_PATH;

export function readStandaloneHashRoute(hash: string): StandaloneHashRoute | null {
  for (const [route, path] of Object.entries(STANDALONE_HASH_PATH)) {
    if (hash === path) return route as StandaloneHashRoute;
    if (hash.startsWith(`${path}?`)) return route as StandaloneHashRoute;
  }
  return null;
}
