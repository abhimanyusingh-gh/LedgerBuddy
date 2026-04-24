/**
 * @jest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { useModalDismiss } from "@/hooks/useModalDismiss";

describe("useModalDismiss", () => {
  it("does nothing when open is false", () => {
    const onClose = jest.fn();
    renderHook(() => useModalDismiss({ open: false, onClose }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("");
  });

  it("locks body scroll while open and restores on close", () => {
    document.body.style.overflow = "scroll";
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useModalDismiss({ open, onClose: () => {} }),
      { initialProps: { open: true } }
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender({ open: false });
    expect(document.body.style.overflow).toBe("scroll");
    document.body.style.overflow = "";
  });

  it("skips scroll lock when lockScroll is false", () => {
    document.body.style.overflow = "auto";
    renderHook(() =>
      useModalDismiss({ open: true, onClose: () => {}, options: { lockScroll: false } })
    );
    expect(document.body.style.overflow).toBe("auto");
    document.body.style.overflow = "";
  });

  it("calls onClose on Escape when open", () => {
    const onClose = jest.fn();
    renderHook(() => useModalDismiss({ open: true, onClose }));

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores previously focused element on close when saveFocusOnOpen is true", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = renderHook(
      ({ open }: { open: boolean }) =>
        useModalDismiss({ open, onClose: () => {}, options: { saveFocusOnOpen: true } }),
      { initialProps: { open: true } }
    );

    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    expect(document.activeElement).toBe(other);

    rerender({ open: false });
    expect(document.activeElement).toBe(trigger);

    document.body.removeChild(trigger);
    document.body.removeChild(other);
  });
});
