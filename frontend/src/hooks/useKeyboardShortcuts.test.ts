/**
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

interface Handlers {
  onMoveDown: jest.Mock;
  onMoveUp: jest.Mock;
  onToggleExpand: jest.Mock;
  onOpenDetail: jest.Mock;
  onApprove: jest.Mock;
  onExport: jest.Mock;
  onEscape: jest.Mock;
  onShowHelp: jest.Mock;
}

function makeHandlers(): Handlers {
  return {
    onMoveDown: jest.fn(),
    onMoveUp: jest.fn(),
    onToggleExpand: jest.fn(),
    onOpenDetail: jest.fn(),
    onApprove: jest.fn(),
    onExport: jest.fn(),
    onEscape: jest.fn(),
    onShowHelp: jest.fn()
  };
}

function renderShortcuts(handlers: Handlers, enabled = true) {
  return renderHook(() => useKeyboardShortcuts({ enabled, ...handlers }));
}

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("fires onMoveDown for 'j' and ArrowDown", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(h.onMoveDown).toHaveBeenCalledTimes(2);
  });

  it("fires onMoveUp for 'k' and ArrowUp", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "ArrowUp" });

    expect(h.onMoveUp).toHaveBeenCalledTimes(2);
  });

  it("fires onToggleExpand for Space and does NOT call onOpenDetail", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: " " });

    expect(h.onToggleExpand).toHaveBeenCalledTimes(1);
    expect(h.onOpenDetail).not.toHaveBeenCalled();
  });

  it("fires onApprove for 'a' and onExport for 'e'", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "e" });

    expect(h.onApprove).toHaveBeenCalledTimes(1);
    expect(h.onExport).toHaveBeenCalledTimes(1);
  });

  it("fires onShowHelp for '?' and onEscape for Escape", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: "?" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(h.onShowHelp).toHaveBeenCalledTimes(1);
    expect(h.onEscape).toHaveBeenCalledTimes(1);
  });

  it("fires onOpenDetail for Enter", () => {
    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(window, { key: "Enter" });

    expect(h.onOpenDetail).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while an INPUT is focused", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(input, { key: "j" });
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(input, { key: "e" });
    fireEvent.keyDown(input, { key: " " });
    fireEvent.keyDown(input, { key: "?" });

    expect(h.onMoveDown).not.toHaveBeenCalled();
    expect(h.onApprove).not.toHaveBeenCalled();
    expect(h.onExport).not.toHaveBeenCalled();
    expect(h.onToggleExpand).not.toHaveBeenCalled();
    expect(h.onShowHelp).not.toHaveBeenCalled();
  });

  it("ignores shortcuts while a contenteditable element is the event target", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    div.setAttribute("tabindex", "0");
    document.body.appendChild(div);

    const h = makeHandlers();
    renderShortcuts(h);

    fireEvent.keyDown(div, { key: "j" });
    fireEvent.keyDown(div, { key: "a" });

    expect(h.onMoveDown).not.toHaveBeenCalled();
    expect(h.onApprove).not.toHaveBeenCalled();
  });

  it("does not attach a listener when disabled", () => {
    const h = makeHandlers();
    renderShortcuts(h, false);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "a" });

    expect(h.onMoveDown).not.toHaveBeenCalled();
    expect(h.onApprove).not.toHaveBeenCalled();
  });

  it("removes the listener on unmount", () => {
    const h = makeHandlers();
    const { unmount } = renderShortcuts(h);

    unmount();
    fireEvent.keyDown(window, { key: "j" });

    expect(h.onMoveDown).not.toHaveBeenCalled();
  });
});
