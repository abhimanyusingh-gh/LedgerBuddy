/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useReorderableSections } from "@/hooks/useReorderableSections";
import { useUserPrefsStore } from "@/stores/userPrefsStore";
import { resetStores } from "@/test-utils/resetStores";

const STORAGE_KEY = "test:section-order";
const DEFAULT_ORDER = ["alpha", "beta", "gamma"];

beforeEach(() => {
  localStorage.clear();
  resetStores();
});

describe("useReorderableSections", () => {
  it("returns default order when no persisted order exists", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns saved order from the userPrefs store", () => {
    useUserPrefsStore.getState().setSectionOrder(STORAGE_KEY, ["gamma", "alpha", "beta"]);
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["gamma", "alpha", "beta"]);
  });

  it("appends new sections not in saved order", () => {
    useUserPrefsStore.getState().setSectionOrder(STORAGE_KEY, ["beta", "alpha"]);
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["beta", "alpha", "gamma"]);
  });

  it("ignores removed sections from saved order", () => {
    useUserPrefsStore
      .getState()
      .setSectionOrder(STORAGE_KEY, ["gamma", "deleted-section", "alpha", "beta"]);
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["gamma", "alpha", "beta"]);
  });

  it("persists new order to the userPrefs store after reorder via drop", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));

    const gammaHandlers = result.current.dragHandlers("gamma");
    const alphaHandlers = result.current.dragHandlers("alpha");

    act(() => {
      gammaHandlers.onDragStart({
        dataTransfer: { effectAllowed: "", setData: () => {} },
      } as unknown as React.DragEvent);
    });

    act(() => {
      alphaHandlers.onDrop({
        preventDefault: () => {},
        dataTransfer: {},
      } as unknown as React.DragEvent);
    });

    expect(result.current.order).toEqual(["gamma", "alpha", "beta"]);

    const stored = useUserPrefsStore.getState().sectionOrder.orderByKey[STORAGE_KEY];
    expect(stored).toEqual(["gamma", "alpha", "beta"]);
  });

  it("sets draggingId on dragStart and clears on dragEnd", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));

    expect(result.current.draggingId).toBeNull();

    const handlers = result.current.dragHandlers("beta");

    act(() => {
      handlers.onDragStart({
        dataTransfer: { effectAllowed: "", setData: () => {} },
      } as unknown as React.DragEvent);
    });

    expect(result.current.draggingId).toBe("beta");

    act(() => {
      handlers.onDragEnd({} as unknown as React.DragEvent);
    });

    expect(result.current.draggingId).toBeNull();
  });

  it("sets dragOverId during dragOver and clears on drop", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));

    const alphaHandlers = result.current.dragHandlers("alpha");
    const betaHandlers = result.current.dragHandlers("beta");

    act(() => {
      alphaHandlers.onDragStart({
        dataTransfer: { effectAllowed: "", setData: () => {} },
      } as unknown as React.DragEvent);
    });

    act(() => {
      betaHandlers.onDragOver({
        preventDefault: () => {},
        dataTransfer: { dropEffect: "" },
      } as unknown as React.DragEvent);
    });

    expect(result.current.dragOverId).toBe("beta");

    act(() => {
      betaHandlers.onDrop({
        preventDefault: () => {},
        dataTransfer: {},
      } as unknown as React.DragEvent);
    });

    expect(result.current.dragOverId).toBeNull();
  });
});
