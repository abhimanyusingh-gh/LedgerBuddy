/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  MAILBOX_FORM_MODE,
  MailboxFormPanel
} from "@/features/admin/mailboxes/MailboxFormPanel";
import type { MailboxAssignment } from "@/api/mailboxAssignments";

const ORGS = [
  { id: "org-1", companyName: "Sharma Textiles" },
  { id: "org-2", companyName: "Bose Steel" }
];

function buildAssignment(overrides: Partial<MailboxAssignment> & { _id: string }): MailboxAssignment {
  return {
    integrationId: `int-${overrides._id}`,
    email: `${overrides._id}@firm.com`,
    clientOrgIds: ["org-1"],
    assignedTo: "all",
    status: "CONNECTED",
    lastSyncedAt: null,
    pollingConfig: null,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

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

const VALID_INTEGRATION_ID = "507f1f77bcf86cd799439011";

describe("features/admin/mailboxes/MailboxFormPanel — Add mode", () => {
  it("requires both an integrationId and at least one client org to enable submit", () => {
    const onSubmit = jest.fn();
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Add}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    const submit = screen.getByTestId("mailbox-form-submit");
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId("mailbox-form-integration-id-input"), {
      target: { value: VALID_INTEGRATION_ID }
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({
      integrationId: VALID_INTEGRATION_ID,
      clientOrgIds: ["org-1"]
    });
  });

  it("blocks submit and surfaces a validation message when integrationId is not a 24-char ObjectId", () => {
    const onSubmit = jest.fn();
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Add}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("mailbox-form-integration-id-input"), {
      target: { value: "int-abc" }
    });
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
    expect(screen.getByTestId("mailbox-form-integration-id-error")).toHaveTextContent(
      /24-character objectid/i
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders the routing preview with the company name when exactly 1 org is selected", () => {
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Add}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
      /auto-assign to Sharma Textiles/i
    );
  });

  it("renders a 'no valid client orgs' affordance when every selected id is an orphan", () => {
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Edit}
        initial={buildAssignment({ _id: "a-1", clientOrgIds: ["org-99"] })}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
      /no valid client organizations/i
    );
  });

  it("renders the GSTIN-routing preview when 2+ orgs are selected", () => {
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Add}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-2"));
    expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
      /match by customer GSTIN.*Triage/i
    );
  });
});

describe("features/admin/mailboxes/MailboxFormPanel — Edit mode", () => {
  it("locks the email field, hides the integrationId field, and pre-selects existing chips", () => {
    const onSubmit = jest.fn();
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Edit}
        initial={buildAssignment({ _id: "a-1", clientOrgIds: ["org-1"] })}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={onSubmit}
        onClose={jest.fn()}
      />
    );
    const email = screen.getByTestId("mailbox-form-email-input") as HTMLInputElement;
    expect(email).toBeDisabled();
    expect(email.value).toBe("a-1@firm.com");
    expect(screen.queryByTestId("mailbox-form-integration-id-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("client-org-multi-picker-chip-org-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mailbox-form-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      integrationId: "int-a-1",
      clientOrgIds: ["org-1"]
    });
  });

  it("disables submit when the user removes every client org", () => {
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Edit}
        initial={buildAssignment({ _id: "a-1", clientOrgIds: ["org-1"] })}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("mailbox-form-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("client-org-multi-picker-chip-remove-org-1"));
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
  });

  it("renders the inline error message when errorMessage is set", () => {
    render(
      <MailboxFormPanel
        open
        mode={MAILBOX_FORM_MODE.Edit}
        initial={buildAssignment({ _id: "a-1" })}
        clientOrgs={ORGS}
        clientOrgsLoading={false}
        clientOrgsError={false}
        onClientOrgsRetry={jest.fn()}
        errorMessage="Cross-tenant clientOrgId rejected."
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByTestId("mailbox-form-error")).toHaveTextContent(
      /cross-tenant clientOrgId rejected/i
    );
  });
});
