/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useDebouncedValue", () => {
  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("does not update until delay elapses", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 500 } }
    );

    rerender({ value: "b", delay: 500 });

    act(() => {
      jest.advanceTimersByTime(499);
    });

    expect(result.current).toBe("a");
  });

  it("updates after delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 500 } }
    );

    rerender({ value: "b", delay: 500 });

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current).toBe("b");
  });

  it("resets timer when value changes before delay", () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "a", delay: 300 } }
    );

    rerender({ value: "b", delay: 300 });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    rerender({ value: "c", delay: 300 });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(result.current).toBe("c");
  });

  it("cleans up timer on unmount", () => {
    const clearTimeoutSpy = jest.spyOn(globalThis, "clearTimeout");

    const { unmount } = renderHook(
      ({ value, delay }) => useDebouncedValue(value, delay),
      { initialProps: { value: "x", delay: 1000 } }
    );

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(expect.any(Number));
    clearTimeoutSpy.mockRestore();
  });
});
