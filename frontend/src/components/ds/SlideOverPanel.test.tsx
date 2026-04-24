/**
 * @jest-environment jsdom
 */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SlideOverPanel } from "@/components/ds/SlideOverPanel";

function Harness({
  initialOpen = true,
  dismissOnBackdrop,
  footer
}: {
  initialOpen?: boolean;
  dismissOnBackdrop?: boolean;
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      <SlideOverPanel
        open={open}
        title="Action Required"
        onClose={() => setOpen(false)}
        dismissOnBackdrop={dismissOnBackdrop}
        footer={footer}
      >
        <button type="button">First</button>
        <button type="button">Last</button>
      </SlideOverPanel>
    </>
  );
}

function mockMatchMedia(matchesReducedMotion: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? matchesReducedMotion : false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    })
  });
}

beforeEach(() => {
  mockMatchMedia(false);
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb) => {
      cb(0);
      return 0;
    });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ds/SlideOverPanel", () => {
  it("renders nothing when closed and unmounts cleanly on close", () => {
    const { rerender, container } = render(
      <SlideOverPanel open={false} title="Hidden" onClose={() => {}}>
        <p>body</p>
      </SlideOverPanel>
    );
    expect(container.innerHTML).toBe("");

    rerender(
      <SlideOverPanel open title="Visible" onClose={() => {}}>
        <p>body</p>
      </SlideOverPanel>
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    rerender(
      <SlideOverPanel open={false} title="Visible" onClose={() => {}}>
        <p>body</p>
      </SlideOverPanel>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("exposes aria-modal and aria-labelledby pointing at the header heading", () => {
    render(<Harness />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelId = dialog.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    const heading = document.getElementById(labelId!);
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("Action Required");
  });

  it("Escape key dismisses and restores focus to the trigger", () => {
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    act(() => {
      trigger.focus();
      fireEvent.click(trigger);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("backdrop click dismisses by default", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("slide-over-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("backdrop click is suppressed when dismissOnBackdrop is false", () => {
    render(<Harness dismissOnBackdrop={false} />);
    fireEvent.click(screen.getByTestId("slide-over-backdrop"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("traps Tab focus so cycling wraps between first and last focusable", () => {
    render(
      <Harness footer={<button type="button">Footer action</button>} />
    );
    const dialog = screen.getByRole("dialog");
    const closeBtn = screen.getByRole("button", { name: "Close panel" });
    const footerBtn = screen.getByRole("button", { name: "Footer action" });

    act(() => footerBtn.focus());
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);

    act(() => closeBtn.focus());
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(footerBtn);
  });

  it("honors prefers-reduced-motion by disabling transitions", () => {
    mockMatchMedia(true);
    render(
      <SlideOverPanel open title="Reduced" onClose={() => {}}>
        <p>body</p>
      </SlideOverPanel>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.transition).toBe("none");
    const backdrop = screen.getByTestId("slide-over-backdrop");
    expect(backdrop.style.transition).toBe("none");
  });
});
