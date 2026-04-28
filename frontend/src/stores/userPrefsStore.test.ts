/**
 * @jest-environment jsdom
 */
import {
  useUserPrefsStore,
  USER_PREFS_STORAGE_KEY,
  TABLE_DENSITY,
  SORT_DIRECTION,
  THEME_MODE,
  TENANT_VIEW_TAB,
  EXPORT_SORT_KEY
} from "@/stores/userPrefsStore";
import { resetStores } from "@/test-utils/resetStores";

beforeEach(() => {
  window.localStorage.clear();
  resetStores();
});

describe("userPrefsStore", () => {
  it("exposes documented defaults on a fresh mount", () => {
    const state = useUserPrefsStore.getState();
    expect(state.invoiceView.panelSplitPercent).toBe(58);
    expect(state.invoiceView.tableDensity).toBe(TABLE_DENSITY.COMFORTABLE);
    expect(state.invoiceView.columnWidths).toEqual({});
    expect(state.invoiceView.sortColumn).toBeNull();
    expect(state.invoiceView.sortDirection).toBe(SORT_DIRECTION.ASC);
    expect(state.theme.mode).toBeNull();
    expect(state.tenantWorkspace.activeTab).toBe(TENANT_VIEW_TAB.OVERVIEW);
    expect(state.exportHistory.pageSize).toBe(20);
    expect(state.exportHistory.sortKey).toBe(EXPORT_SORT_KEY.DATE);
    expect(state.exportHistory.sortDirection).toBe(SORT_DIRECTION.DESC);
  });

  it("setInvoiceView merges patch and persists to localStorage under the canonical key", () => {
    useUserPrefsStore.getState().setInvoiceView({ panelSplitPercent: 42 });
    expect(useUserPrefsStore.getState().invoiceView.panelSplitPercent).toBe(42);
    const raw = window.localStorage.getItem(USER_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.invoiceView.panelSplitPercent).toBe(42);
  });

  it("setInvoiceView preserves untouched fields when patching", () => {
    useUserPrefsStore.getState().setInvoiceView({ tableDensity: TABLE_DENSITY.COMPACT });
    useUserPrefsStore.getState().setInvoiceView({ panelSplitPercent: 70 });
    const view = useUserPrefsStore.getState().invoiceView;
    expect(view.tableDensity).toBe(TABLE_DENSITY.COMPACT);
    expect(view.panelSplitPercent).toBe(70);
  });

  it("setTheme stores explicit mode and supports clearing back to null", () => {
    useUserPrefsStore.getState().setTheme(THEME_MODE.DARK);
    expect(useUserPrefsStore.getState().theme.mode).toBe(THEME_MODE.DARK);
    useUserPrefsStore.getState().setTheme(null);
    expect(useUserPrefsStore.getState().theme.mode).toBeNull();
  });

  it("setSectionOrder + setInvoicePreviewZoom maintain per-key maps independently", () => {
    useUserPrefsStore.getState().setSectionOrder("config", ["a", "b", "c"]);
    useUserPrefsStore.getState().setSectionOrder("connections", ["x", "y"]);
    useUserPrefsStore.getState().setInvoicePreviewZoom("inv-1", 1.5);
    useUserPrefsStore.getState().setInvoicePreviewZoom("inv-2", 2.25);

    const state = useUserPrefsStore.getState();
    expect(state.sectionOrder.orderByKey.config).toEqual(["a", "b", "c"]);
    expect(state.sectionOrder.orderByKey.connections).toEqual(["x", "y"]);
    expect(state.invoicePreview.zoomByKey["inv-1"]).toBe(1.5);
    expect(state.invoicePreview.zoomByKey["inv-2"]).toBe(2.25);
  });

  it("setUrlMigrationDismissal(null, key) removes the entry", () => {
    useUserPrefsStore
      .getState()
      .setUrlMigrationDismissal("k", { dismissed: true, timestamp: 123 });
    expect(useUserPrefsStore.getState().urlMigration.dismissalsByKey.k).toBeDefined();
    useUserPrefsStore.getState().setUrlMigrationDismissal("k", null);
    expect(useUserPrefsStore.getState().urlMigration.dismissalsByKey.k).toBeUndefined();
  });

  it("resetStores() restores the documented defaults", () => {
    useUserPrefsStore.getState().setInvoiceView({ panelSplitPercent: 11 });
    useUserPrefsStore.getState().setTheme(THEME_MODE.DARK);
    expect(useUserPrefsStore.getState().invoiceView.panelSplitPercent).toBe(11);

    resetStores();

    expect(useUserPrefsStore.getState().invoiceView.panelSplitPercent).toBe(58);
    expect(useUserPrefsStore.getState().theme.mode).toBeNull();
  });

  it("rehydrates persisted state across simulated remount", () => {
    useUserPrefsStore.getState().setExportHistory({ pageSize: 50 });
    const raw = window.localStorage.getItem(USER_PREFS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state.exportHistory.pageSize).toBe(50);
  });
});
