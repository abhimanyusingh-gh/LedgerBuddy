/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

const baseProps = {
  open: true,
  title: "Delete Invoice",
  message: "Are you sure?",
  onConfirm: jest.fn(),
  onCancel: jest.fn()
};

beforeEach(() => jest.clearAllMocks());

describe("ConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(<ConfirmDialog {...baseProps} open={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders title, message, and default confirm label", () => {
    render(<ConfirmDialog {...baseProps} />);
    expect(screen.getByText("Delete Invoice")).toBeTruthy();
    expect(screen.getByText("Are you sure?")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
  });

  it("calls onConfirm/onCancel on respective button clicks", () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel on overlay click but not on card click", () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog {...baseProps} onCancel={onCancel} />);

    fireEvent.click(document.querySelector(".popup-card") as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".popup-overlay") as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("applies destructive styling and custom confirmLabel", () => {
    render(<ConfirmDialog {...baseProps} destructive confirmLabel="Delete Forever" />);
    const btn = screen.getByText("Delete Forever");
    expect(btn.style.background).toBe("var(--warn)");
  });

  it("has alertdialog role with aria-modal", () => {
    render(<ConfirmDialog {...baseProps} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Delete Invoice");
  });
});
