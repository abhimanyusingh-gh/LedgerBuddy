/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  MAILBOX_FORM_MODE,
  MailboxFormPanel,
  type MailboxFormMode
} from "@/features/admin/mailboxes/MailboxFormPanel";
import type {
  AvailableIntegration,
  MailboxAssignment
} from "@/api/mailboxAssignments";
import { resetStores } from "@/test-utils/resetStores";

jest.mock("@/api/mailboxAssignments", () => ({
  listIntegrations: jest.fn()
}));

const { listIntegrations } = jest.requireMock("@/api/mailboxAssignments") as {
  listIntegrations: jest.Mock<Promise<AvailableIntegration[]>, []>;
};

const ORGS = [
  { id: "org-1", companyName: "Sharma Textiles" },
  { id: "org-2", companyName: "Bose Steel" }
];

const VALID_INTEGRATION_ID = "507f1f77bcf86cd799439011";
const SECOND_INTEGRATION_ID = "507f1f77bcf86cd799439012";

const SAMPLE_INTEGRATIONS: AvailableIntegration[] = [
  {
    _id: VALID_INTEGRATION_ID,
    emailAddress: "alpha@firm.com",
    status: "CONNECTED",
    provider: "gmail"
  },
  {
    _id: SECOND_INTEGRATION_ID,
    emailAddress: "beta@firm.com",
    status: "PENDING",
    provider: "gmail"
  }
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

function renderPanel(opts: {
  mode: MailboxFormMode;
  initial?: MailboxAssignment | null;
  onSubmit?: (...args: unknown[]) => void;
  errorMessage?: string | null;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <MailboxFormPanel
      open
      mode={opts.mode}
      initial={opts.initial ?? null}
      clientOrgs={ORGS}
      clientOrgsLoading={false}
      clientOrgsError={false}
      onClientOrgsRetry={jest.fn()}
      errorMessage={opts.errorMessage ?? null}
      onSubmit={opts.onSubmit ?? jest.fn()}
      onClose={jest.fn()}
    />,
    { wrapper }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  resetStores();
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

describe("features/admin/mailboxes/MailboxFormPanel — Add mode picker", () => {
  it("renders fetched integrations as picker options labelled 'email (provider, status)' and submits the chosen _id", async () => {
    listIntegrations.mockResolvedValueOnce(SAMPLE_INTEGRATIONS);
    const onSubmit = jest.fn();
    renderPanel({ mode: MAILBOX_FORM_MODE.Add, onSubmit });

    const select = (await screen.findByTestId(
      "mailbox-form-integration-id-select"
    )) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.text);
    expect(optionLabels).toContain("alpha@firm.com (gmail, CONNECTED)");
    expect(optionLabels).toContain("beta@firm.com (gmail, PENDING)");

    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
    fireEvent.change(select, { target: { value: SECOND_INTEGRATION_ID } });
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    fireEvent.click(screen.getByTestId("mailbox-form-submit"));

    expect(onSubmit).toHaveBeenCalledWith({
      integrationId: SECOND_INTEGRATION_ID,
      clientOrgIds: ["org-1"]
    });
  });

  it("shows a loading affordance while integrations are in flight", () => {
    listIntegrations.mockReturnValueOnce(new Promise(() => {}));
    renderPanel({ mode: MAILBOX_FORM_MODE.Add });
    expect(screen.getByTestId("mailbox-form-integration-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("mailbox-form-integration-id-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
  });

  it("renders the empty-state message and keeps submit disabled when no integrations are available", async () => {
    listIntegrations.mockResolvedValueOnce([]);
    renderPanel({ mode: MAILBOX_FORM_MODE.Add });
    expect(
      await screen.findByTestId("mailbox-form-integration-empty")
    ).toHaveTextContent(/no available integrations/i);
    expect(screen.queryByTestId("mailbox-form-integration-id-select")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
  });

  it("renders an error + retry affordance and keeps submit disabled when the integrations fetch errors", async () => {
    listIntegrations.mockRejectedValueOnce(new Error("boom"));
    listIntegrations.mockResolvedValueOnce(SAMPLE_INTEGRATIONS);
    const onSubmit = jest.fn();
    renderPanel({ mode: MAILBOX_FORM_MODE.Add, onSubmit });

    expect(
      await screen.findByTestId("mailbox-form-integration-error")
    ).toHaveTextContent(/couldn't load integrations/i);
    expect(screen.queryByTestId("mailbox-form-integration-id-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mailbox-form-integration-id-select")).not.toBeInTheDocument();
    expect(listIntegrations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();

    fireEvent.click(screen.getByTestId("mailbox-form-integration-retry"));
    const select = (await screen.findByTestId(
      "mailbox-form-integration-id-select"
    )) as HTMLSelectElement;
    expect(listIntegrations).toHaveBeenCalledTimes(2);
    fireEvent.change(select, { target: { value: VALID_INTEGRATION_ID } });
    fireEvent.click(screen.getByTestId("mailbox-form-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      integrationId: VALID_INTEGRATION_ID,
      clientOrgIds: ["org-1"]
    });
  });

  it("renders the routing preview with the company name when exactly 1 org is selected", async () => {
    listIntegrations.mockResolvedValueOnce(SAMPLE_INTEGRATIONS);
    renderPanel({ mode: MAILBOX_FORM_MODE.Add });
    await screen.findByTestId("mailbox-form-integration-id-select");
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
      /auto-assign to Sharma Textiles/i
    );
  });

  it("renders the GSTIN-routing preview when 2+ orgs are selected", async () => {
    listIntegrations.mockResolvedValueOnce(SAMPLE_INTEGRATIONS);
    renderPanel({ mode: MAILBOX_FORM_MODE.Add });
    await screen.findByTestId("mailbox-form-integration-id-select");
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-2"));
    expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
      /match by customer GSTIN.*Triage/i
    );
  });
});

describe("features/admin/mailboxes/MailboxFormPanel — Edit mode", () => {
  it("does NOT trigger the integrations fetch in Edit mode", () => {
    renderPanel({
      mode: MAILBOX_FORM_MODE.Edit,
      initial: buildAssignment({ _id: "a-1" })
    });
    expect(listIntegrations).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mailbox-form-integration-id-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mailbox-form-integration-id-input")).not.toBeInTheDocument();
  });

  it("locks the email field, hides the integration picker, and pre-selects existing chips", () => {
    const onSubmit = jest.fn();
    renderPanel({
      mode: MAILBOX_FORM_MODE.Edit,
      initial: buildAssignment({ _id: "a-1", clientOrgIds: ["org-1"] }),
      onSubmit
    });
    const email = screen.getByTestId("mailbox-form-email-input") as HTMLInputElement;
    expect(email).toBeDisabled();
    expect(email.value).toBe("a-1@firm.com");
    expect(screen.getByTestId("client-org-multi-picker-chip-org-1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mailbox-form-submit"));
    expect(onSubmit).toHaveBeenCalledWith({
      integrationId: "int-a-1",
      clientOrgIds: ["org-1"]
    });
  });

  it("disables submit when the user removes every client org", () => {
    renderPanel({
      mode: MAILBOX_FORM_MODE.Edit,
      initial: buildAssignment({ _id: "a-1", clientOrgIds: ["org-1"] })
    });
    expect(screen.getByTestId("mailbox-form-submit")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("client-org-multi-picker-chip-remove-org-1"));
    expect(screen.getByTestId("mailbox-form-submit")).toBeDisabled();
  });

  it("renders the inline error message when errorMessage is set", () => {
    renderPanel({
      mode: MAILBOX_FORM_MODE.Edit,
      initial: buildAssignment({ _id: "a-1" }),
      errorMessage: "Cross-tenant clientOrgId rejected."
    });
    expect(screen.getByTestId("mailbox-form-error")).toHaveTextContent(
      /cross-tenant clientOrgId rejected/i
    );
  });

  it("renders the 'no valid client orgs' affordance when every selected id is an orphan", async () => {
    renderPanel({
      mode: MAILBOX_FORM_MODE.Edit,
      initial: buildAssignment({ _id: "a-1", clientOrgIds: ["org-99"] })
    });
    await waitFor(() =>
      expect(screen.getByTestId("mailbox-form-routing-preview")).toHaveTextContent(
        /no valid client organizations/i
      )
    );
  });
});
