/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useToast } from "@/hooks/useToast";

let uuidCounter = 0;
beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      randomUUID: () => `uuid-${++uuidCounter}`
    },
    writable: true
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  uuidCounter = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useToast", () => {
  it("addToast adds a toast with correct type, message, and duration", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("success", "Saved", 3000);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0]).toEqual({
      id: "uuid-1",
      type: "success",
      message: "Saved",
      duration: 3000
    });
  });

  it("addToast generates unique IDs", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("info", "First");
      result.current.addToast("error", "Second");
    });

    const ids = result.current.toasts.map((t) => t.id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("addToast defaults duration to 4000", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("info", "Default duration");
    });

    expect(result.current.toasts[0].duration).toBe(4000);
  });

  it("removeToast removes the specified toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("success", "Keep");
      result.current.addToast("error", "Remove");
    });

    const idToRemove = result.current.toasts[1].id;

    act(() => {
      result.current.removeToast(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Keep");
  });

  it("auto-removes toast after duration + 200ms", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("success", "Bye", 2000);
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(2199);
    });

    expect(result.current.toasts).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(result.current.toasts).toHaveLength(0);
  });

  it("multiple toasts can coexist", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("success", "First");
      result.current.addToast("error", "Second");
      result.current.addToast("info", "Third");
    });

    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts.map((t) => t.type)).toEqual(["success", "error", "info"]);
  });
});
