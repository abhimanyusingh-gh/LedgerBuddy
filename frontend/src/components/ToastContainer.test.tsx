/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastContainer } from "./ToastContainer";
import type { Toast } from "../hooks/useToast";

const makeToast = (overrides: Partial<Toast> = {}): Toast => ({
  id: "toast-1",
  type: "success",
  message: "Operation completed",
  duration: 4000,
  ...overrides
});

describe("ToastContainer", () => {
  it("renders nothing when toasts array is empty", () => {
    const { container } = render(<ToastContainer toasts={[]} onRemove={jest.fn()} />);
    expect(container.innerHTML).toBe("");
  });

  it.each([
    ["success", "check_circle"],
    ["error", "error"],
    ["info", "info"]
  ] as const)("renders %s toast with correct class and icon", (type, expectedIcon) => {
    render(<ToastContainer toasts={[makeToast({ type })]} onRemove={jest.fn()} />);
    expect(document.querySelector(`.toast-${type}`)).toBeTruthy();
    expect(document.querySelector(".toast-icon")?.textContent).toBe(expectedIcon);
  });

  it("shows toast message text", () => {
    render(<ToastContainer toasts={[makeToast({ message: "File uploaded" })]} onRemove={jest.fn()} />);
    expect(screen.getByText("File uploaded")).toBeTruthy();
  });

  it("calls onRemove when dismiss button is clicked after exit animation", () => {
    jest.useFakeTimers();
    const onRemove = jest.fn();
    render(<ToastContainer toasts={[makeToast()]} onRemove={onRemove} />);

    fireEvent.click(document.querySelector(".toast-dismiss") as HTMLButtonElement);
    jest.advanceTimersByTime(200);

    expect(onRemove).toHaveBeenCalledWith("toast-1");
    jest.useRealTimers();
  });

  it("renders multiple toasts", () => {
    render(<ToastContainer toasts={[
      makeToast({ id: "t1", message: "First" }),
      makeToast({ id: "t2", message: "Second" })
    ]} onRemove={jest.fn()} />);
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
  });
});
