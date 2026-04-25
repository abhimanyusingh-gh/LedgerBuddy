/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RejectDialog } from "@/features/triage/RejectDialog";

function renderDialog(overrides: Partial<React.ComponentProps<typeof RejectDialog>> = {}) {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const props: React.ComponentProps<typeof RejectDialog> = {
    open: true,
    invoiceCount: 1,
    isSubmitting: false,
    onConfirm,
    onCancel,
    ...overrides
  };
  return { onConfirm, onCancel, props, ...render(<RejectDialog {...props} />) };
}

describe("features/triage/RejectDialog", () => {
  it("returns null when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("reject-dialog-overlay")).not.toBeInTheDocument();
  });

  it("renders the singular title for one invoice", () => {
    renderDialog({ invoiceCount: 1 });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Reject invoice");
  });

  it("renders the plural title for bulk rejection", () => {
    renderDialog({ invoiceCount: 3 });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Reject 3 invoices");
  });

  it("defaults the reason to 'not_for_any_client' and confirms with the structured payload", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: "not_for_any_client" });
  });

  it("includes free-text notes alongside reasonCode in the payload", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-dialog-reason-wrong_vendor"));
    fireEvent.change(screen.getByTestId("reject-dialog-freetext"), { target: { value: "Wrong AP" } });
    fireEvent.click(screen.getByTestId("reject-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: "wrong_vendor", notes: "Wrong AP" });
  });

  it("requires free text when reason is Other and disables confirm until provided", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-dialog-reason-other"));
    expect(screen.getByTestId("reject-dialog-confirm")).toBeDisabled();
    fireEvent.change(screen.getByTestId("reject-dialog-freetext"), { target: { value: "Personal" } });
    expect(screen.getByTestId("reject-dialog-confirm")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("reject-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledWith({ reasonCode: "other", notes: "Personal" });
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByTestId("reject-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both action buttons while submitting", () => {
    renderDialog({ isSubmitting: true });
    expect(screen.getByTestId("reject-dialog-cancel")).toBeDisabled();
    expect(screen.getByTestId("reject-dialog-confirm")).toBeDisabled();
    expect(screen.getByTestId("reject-dialog-confirm")).toHaveTextContent(/rejecting/i);
  });
});
