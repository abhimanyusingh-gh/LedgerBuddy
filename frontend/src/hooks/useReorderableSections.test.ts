/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useReorderableSections } from "@/hooks/useReorderableSections";

const STORAGE_KEY = "test:section-order";
const DEFAULT_ORDER = ["alpha", "beta", "gamma"];

beforeEach(() => {
  localStorage.clear();
});

describe("useReorderableSections", () => {
  it("returns default order when localStorage is empty", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns saved order from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["gamma", "alpha", "beta"]));
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["gamma", "alpha", "beta"]);
  });

  it("appends new sections not in saved order", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["beta", "alpha"]));
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["beta", "alpha", "gamma"]);
  });

  it("ignores removed sections from saved order", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["gamma", "deleted-section", "alpha", "beta"]));
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["gamma", "alpha", "beta"]);
  });

  it("persists new order to localStorage after reorder via drop", () => {
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

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual(["gamma", "alpha", "beta"]);
  });

  it("handles corrupted localStorage gracefully (falls back to default)", () => {
    localStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("falls back to default when localStorage contains non-array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 1 }));
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
  });

  it("falls back to default when localStorage contains array of non-strings", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));
    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
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

  it("does not reorder when dropping on itself", () => {
    const { result } = renderHook(() => useReorderableSections(STORAGE_KEY, DEFAULT_ORDER));

    const alphaHandlers = result.current.dragHandlers("alpha");

    act(() => {
      alphaHandlers.onDragStart({
        dataTransfer: { effectAllowed: "", setData: () => {} },
      } as unknown as React.DragEvent);
    });

    act(() => {
      alphaHandlers.onDrop({
        preventDefault: () => {},
        dataTransfer: {},
      } as unknown as React.DragEvent);
    });

    expect(result.current.order).toEqual(["alpha", "beta", "gamma"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
