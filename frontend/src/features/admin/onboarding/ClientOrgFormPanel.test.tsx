/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CLIENT_ORG_FORM_MODE,
  ClientOrgFormPanel
} from "@/features/admin/onboarding/ClientOrgFormPanel";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn()
    })
  });
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("features/admin/onboarding/ClientOrgFormPanel — add mode", () => {
  it("uppercases the GSTIN input as the user types and surfaces a format error below the threshold", () => {
    render(
      <ClientOrgFormPanel
        open
        mode={CLIENT_ORG_FORM_MODE.Add}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    const gstin = screen.getByTestId("client-org-gstin-input") as HTMLInputElement;
    fireEvent.change(gstin, { target: { value: "29abc" } });
    expect(gstin.value).toBe("29ABC");
    expect(gstin).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/15-character/i);
  });

  it("submits trimmed values when the form is valid", () => {
    const onSubmit = jest.fn();
    render(
      <ClientOrgFormPanel
        open
        mode={CLIENT_ORG_FORM_MODE.Add}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("client-org-gstin-input"), {
      target: { value: "29ABCPK1234F1Z5" }
    });
    fireEvent.change(screen.getByTestId("client-org-company-name-input"), {
      target: { value: "  Acme  " }
    });
    fireEvent.change(screen.getByTestId("client-org-state-name-input"), {
      target: { value: " Karnataka " }
    });

    fireEvent.click(screen.getByTestId("client-org-form-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      gstin: "29ABCPK1234F1Z5",
      companyName: "Acme",
      stateName: "Karnataka",
      f12OverwriteByGuidVerified: false
    });
  });
});

describe("features/admin/onboarding/ClientOrgFormPanel — edit mode", () => {
  it("locks the GSTIN input and pre-populates the rest of the form", () => {
    render(
      <ClientOrgFormPanel
        open
        mode={CLIENT_ORG_FORM_MODE.Edit}
        initial={{
          _id: "org-1",
          tenantId: "tenant-1",
          gstin: "29ABCPK1234F1Z5",
          companyName: "Sharma Textiles",
          stateName: "Karnataka",
          f12OverwriteByGuidVerified: true,
          detectedVersion: null,
          createdAt: "2026-04-20T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z"
        }}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    const gstin = screen.getByTestId("client-org-gstin-input") as HTMLInputElement;
    expect(gstin).toBeDisabled();
    expect(gstin.value).toBe("29ABCPK1234F1Z5");
    const company = screen.getByTestId("client-org-company-name-input") as HTMLInputElement;
    expect(company.value).toBe("Sharma Textiles");
    const f12 = screen.getByTestId("client-org-f12-checkbox") as HTMLInputElement;
    expect(f12.checked).toBe(true);
    expect(screen.getByTestId("client-org-form-submit")).toHaveTextContent(/save/i);
  });

  it("surfaces an externally-provided error message", () => {
    render(
      <ClientOrgFormPanel
        open
        mode={CLIENT_ORG_FORM_MODE.Add}
        errorMessage="Duplicate GSTIN under this tenant."
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("client-org-form-error")).toHaveTextContent(/duplicate/i);
  });
});
