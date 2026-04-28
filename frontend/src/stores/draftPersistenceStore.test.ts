/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import {
  DRAFT_PERSISTENCE_STORAGE_KEY,
  DRAFT_TTL_MS,
  useDraft,
  useDraftStore
} from "@/stores/draftPersistenceStore";
import { resetStores } from "@/test-utils/resetStores";

const KEY = "test/form-1";
const KEY_OTHER = "test/form-2";

beforeEach(() => {
  window.sessionStorage.clear();
  resetStores();
});

describe("draftPersistenceStore", () => {
  it("setDraft + getDraft round-trips arbitrary JSON-shaped values", () => {
    useDraftStore.getState().setDraft(KEY, { name: "Acme", count: 3 });
    expect(useDraftStore.getState().getDraft(KEY)).toEqual({ name: "Acme", count: 3 });
  });

  it("persists drafts under the namespaced sessionStorage key with state envelope", () => {
    useDraftStore.getState().setDraft(KEY, { gstin: "29ABCDE1234F1Z5" });
    const raw = window.sessionStorage.getItem(DRAFT_PERSISTENCE_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as { state: { drafts: Record<string, unknown> } };
    expect(parsed.state.drafts[KEY]).toBeDefined();
  });

  it("clearDraft removes only the targeted key", () => {
    useDraftStore.getState().setDraft(KEY, { a: 1 });
    useDraftStore.getState().setDraft(KEY_OTHER, { b: 2 });
    useDraftStore.getState().clearDraft(KEY);
    expect(useDraftStore.getState().getDraft(KEY)).toBeUndefined();
    expect(useDraftStore.getState().getDraft(KEY_OTHER)).toEqual({ b: 2 });
  });

  it("pruneStale drops entries older than ttl and keeps fresh ones", () => {
    const now = 10_000_000;
    jest.spyOn(Date, "now").mockReturnValue(now - DRAFT_TTL_MS.Default - 1);
    useDraftStore.getState().setDraft(KEY, { stale: true });
    jest.spyOn(Date, "now").mockReturnValue(now);
    useDraftStore.getState().setDraft(KEY_OTHER, { fresh: true });
    useDraftStore.getState().pruneStale(DRAFT_TTL_MS.Default);
    expect(useDraftStore.getState().getDraft(KEY)).toBeUndefined();
    expect(useDraftStore.getState().getDraft(KEY_OTHER)).toEqual({ fresh: true });
  });

  it("resetStores() restores empty state (lock contract)", () => {
    useDraftStore.getState().setDraft(KEY, { x: 1 });
    expect(useDraftStore.getState().getDraft(KEY)).toEqual({ x: 1 });
    resetStores();
    expect(useDraftStore.getState().drafts).toEqual({});
  });

  it("useDraft hook exposes [value, set, clear] tuple and survives remount (lock contract)", () => {
    interface Form { name: string; n: number }
    const first = renderHook(() => useDraft<Form>(KEY));
    act(() => first.result.current[1]({ name: "Acme", n: 2 }));
    expect(first.result.current[0]).toEqual({ name: "Acme", n: 2 });
    first.unmount();

    const second = renderHook(() => useDraft<Form>(KEY));
    expect(second.result.current[0]).toEqual({ name: "Acme", n: 2 });

    act(() => second.result.current[2]());
    expect(second.result.current[0]).toBeUndefined();
  });

  it("useDraft hook respects ttlMs option (returns undefined for stale entries without mutating store)", () => {
    const baseline = 5_000_000;
    jest.spyOn(Date, "now").mockReturnValue(baseline);
    useDraftStore.getState().setDraft(KEY, { v: 1 });
    jest.spyOn(Date, "now").mockReturnValue(baseline + DRAFT_TTL_MS.Short + 1);
    const { result } = renderHook(() => useDraft<{ v: number }>(KEY, { ttlMs: DRAFT_TTL_MS.Short }));
    expect(result.current[0]).toBeUndefined();
    expect(useDraftStore.getState().drafts[KEY]).toBeDefined();
  });
});
