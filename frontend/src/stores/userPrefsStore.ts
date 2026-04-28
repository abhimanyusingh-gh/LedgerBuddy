import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { registerStoreReset } from "@/test-utils/resetStores";

export const USER_PREFS_STORAGE_KEY = "ledgerbuddy:userPrefs";

export const TABLE_DENSITY = {
  COMPACT: "compact",
  COMFORTABLE: "comfortable",
  SPACIOUS: "spacious"
} as const;
export type TableDensity = (typeof TABLE_DENSITY)[keyof typeof TABLE_DENSITY];

export const SORT_DIRECTION = {
  ASC: "asc",
  DESC: "desc"
} as const;
type SortDirection = (typeof SORT_DIRECTION)[keyof typeof SORT_DIRECTION];

export const THEME_MODE = {
  LIGHT: "light",
  DARK: "dark"
} as const;
export type ThemeMode = (typeof THEME_MODE)[keyof typeof THEME_MODE];

export const TENANT_VIEW_TAB = {
  OVERVIEW: "overview",
  DASHBOARD: "dashboard",
  CONFIG: "config",
  EXPORTS: "exports",
  STATEMENTS: "statements",
  CONNECTIONS: "connections"
} as const;
type TenantViewTabPref = (typeof TENANT_VIEW_TAB)[keyof typeof TENANT_VIEW_TAB];

export const EXPORT_SORT_KEY = {
  DATE: "date",
  TOTAL: "total",
  SUCCESS: "success",
  FAILED: "failed",
  REQUESTED_BY: "requestedBy"
} as const;
export type ExportSortKey = (typeof EXPORT_SORT_KEY)[keyof typeof EXPORT_SORT_KEY];

interface IngestionOverlayPosition {
  x: number;
  y: number;
}

interface UrlMigrationDismissal {
  dismissed: boolean;
  timestamp: number;
}

interface InvoiceViewPrefs {
  panelSplitPercent: number;
  tableDensity: TableDensity;
  columnWidths: Record<string, number>;
  sortColumn: string | null;
  sortDirection: SortDirection;
}

interface ThemePrefs {
  mode: ThemeMode | null;
}

interface TenantWorkspacePrefs {
  activeTab: TenantViewTabPref;
}

interface ExportHistoryPrefs {
  pageSize: number;
  dateFrom: string;
  dateTo: string;
  sortKey: ExportSortKey;
  sortDirection: SortDirection;
}

interface IngestionOverlayPrefs {
  position: IngestionOverlayPosition | null;
}

interface InvoicePreviewPrefs {
  zoomByKey: Record<string, number>;
}

interface SectionOrderPrefs {
  orderByKey: Record<string, string[]>;
}

interface UrlMigrationPrefs {
  dismissalsByKey: Record<string, UrlMigrationDismissal>;
}

interface UserPrefsState {
  invoiceView: InvoiceViewPrefs;
  theme: ThemePrefs;
  tenantWorkspace: TenantWorkspacePrefs;
  exportHistory: ExportHistoryPrefs;
  ingestionOverlay: IngestionOverlayPrefs;
  invoicePreview: InvoicePreviewPrefs;
  sectionOrder: SectionOrderPrefs;
  urlMigration: UrlMigrationPrefs;
  setInvoiceView: (patch: Partial<InvoiceViewPrefs>) => void;
  setTheme: (mode: ThemeMode | null) => void;
  setTenantWorkspaceTab: (tab: TenantViewTabPref) => void;
  setExportHistory: (patch: Partial<ExportHistoryPrefs>) => void;
  setIngestionOverlayPosition: (position: IngestionOverlayPosition | null) => void;
  setInvoicePreviewZoom: (key: string, zoom: number) => void;
  setSectionOrder: (key: string, order: string[]) => void;
  setUrlMigrationDismissal: (key: string, dismissal: UrlMigrationDismissal | null) => void;
}

const DEFAULTS = {
  invoiceView: {
    panelSplitPercent: 58,
    tableDensity: TABLE_DENSITY.COMFORTABLE,
    columnWidths: {},
    sortColumn: null,
    sortDirection: SORT_DIRECTION.ASC
  },
  theme: { mode: null },
  tenantWorkspace: { activeTab: TENANT_VIEW_TAB.OVERVIEW },
  exportHistory: {
    pageSize: 20,
    dateFrom: "",
    dateTo: "",
    sortKey: EXPORT_SORT_KEY.DATE,
    sortDirection: SORT_DIRECTION.DESC
  },
  ingestionOverlay: { position: null },
  invoicePreview: { zoomByKey: {} },
  sectionOrder: { orderByKey: {} },
  urlMigration: { dismissalsByKey: {} }
} satisfies Pick<
  UserPrefsState,
  | "invoiceView"
  | "theme"
  | "tenantWorkspace"
  | "exportHistory"
  | "ingestionOverlay"
  | "invoicePreview"
  | "sectionOrder"
  | "urlMigration"
>;

export const useUserPrefsStore = create<UserPrefsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setInvoiceView: (patch) =>
        set((state) => ({ invoiceView: { ...state.invoiceView, ...patch } })),
      setTheme: (mode) => set({ theme: { mode } }),
      setTenantWorkspaceTab: (tab) => set({ tenantWorkspace: { activeTab: tab } }),
      setExportHistory: (patch) =>
        set((state) => ({ exportHistory: { ...state.exportHistory, ...patch } })),
      setIngestionOverlayPosition: (position) => set({ ingestionOverlay: { position } }),
      setInvoicePreviewZoom: (key, zoom) =>
        set((state) => ({
          invoicePreview: {
            zoomByKey: { ...state.invoicePreview.zoomByKey, [key]: zoom }
          }
        })),
      setSectionOrder: (key, order) =>
        set((state) => ({
          sectionOrder: {
            orderByKey: { ...state.sectionOrder.orderByKey, [key]: order }
          }
        })),
      setUrlMigrationDismissal: (key, dismissal) =>
        set((state) => {
          const next = { ...state.urlMigration.dismissalsByKey };
          if (dismissal === null) {
            delete next[key];
          } else {
            next[key] = dismissal;
          }
          return { urlMigration: { dismissalsByKey: next } };
        })
    }),
    {
      name: USER_PREFS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        invoiceView: state.invoiceView,
        theme: state.theme,
        tenantWorkspace: state.tenantWorkspace,
        exportHistory: state.exportHistory,
        ingestionOverlay: state.ingestionOverlay,
        invoicePreview: state.invoicePreview,
        sectionOrder: state.sectionOrder,
        urlMigration: state.urlMigration
      })
    }
  )
);

registerStoreReset(() => useUserPrefsStore.setState({ ...DEFAULTS }));
