/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NotificationPreferencesSection } from "./NotificationPreferencesSection";

const mockFetchNotificationConfig = jest.fn();
const mockSaveNotificationConfig = jest.fn();
const mockFetchNotificationLog = jest.fn();

jest.mock("@/api/admin", () => ({
  fetchNotificationConfig: (...args: unknown[]) => mockFetchNotificationConfig(...args),
  saveNotificationConfig: (...args: unknown[]) => mockSaveNotificationConfig(...args),
  fetchNotificationLog: (...args: unknown[]) => mockFetchNotificationLog(...args)
}));

const TENANT_USERS = [
  { userId: "u-1", email: "admin@test.com", role: "TENANT_ADMIN" as const, enabled: true },
  { userId: "u-2", email: "member@test.com", role: "ap_clerk" as const, enabled: true }
];

const DEFAULT_CONFIG = {
  mailboxReauthEnabled: true,
  escalationEnabled: true,
  inAppEnabled: false,
  primaryRecipientType: "integration_creator" as const,
  specificRecipientUserId: null
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("NotificationPreferencesSection", () => {
  it("renders toggles with default values", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    const mailboxToggle = screen.getByLabelText("Mailbox reauth notifications") as HTMLInputElement;
    expect(mailboxToggle.checked).toBe(true);

    const escalationToggle = screen.getByLabelText("Escalation notifications") as HTMLInputElement;
    expect(escalationToggle.checked).toBe(true);

    const inAppToggle = screen.getByLabelText("In-app notifications (coming soon)") as HTMLInputElement;
    expect(inAppToggle).toBeDisabled();
    expect(inAppToggle.checked).toBe(false);
  });

  it("renders recipient selector", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    const recipientSelect = screen.getByLabelText("Primary notification recipient") as HTMLSelectElement;
    expect(recipientSelect.value).toBe("integration_creator");
  });

  it("shows loading state", () => {
    mockFetchNotificationConfig.mockReturnValue(new Promise(() => {}));
    render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    expect(screen.getByText("Loading notification preferences...")).toBeInTheDocument();
  });

  it("shows error state with retry button on load failure", async () => {
    mockFetchNotificationConfig.mockRejectedValue(new Error("Network error"));
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    expect(screen.getByText("Failed to load notification preferences.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows save button only when dirty", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    expect(screen.queryByText("Save Preferences")).not.toBeInTheDocument();

    const mailboxToggle = screen.getByLabelText("Mailbox reauth notifications");
    fireEvent.click(mailboxToggle);

    expect(screen.getByText("Save Preferences")).toBeInTheDocument();
  });

  it("calls saveNotificationConfig on save", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockSaveNotificationConfig.mockResolvedValue({ ...DEFAULT_CONFIG, mailboxReauthEnabled: false });
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    const mailboxToggle = screen.getByLabelText("Mailbox reauth notifications");
    fireEvent.click(mailboxToggle);

    const saveBtn = screen.getByText("Save Preferences");
    await act(async () => { fireEvent.click(saveBtn); });

    expect(mockSaveNotificationConfig).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxReauthEnabled: false })
    );
    expect(screen.getByText("Notification preferences saved.")).toBeInTheDocument();
  });

  it("shows inline error on save failure", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    mockSaveNotificationConfig.mockRejectedValue({ code: "UNKNOWN" });
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    const mailboxToggle = screen.getByLabelText("Mailbox reauth notifications");
    fireEvent.click(mailboxToggle);

    const saveBtn = screen.getByText("Save Preferences");
    await act(async () => { fireEvent.click(saveBtn); });

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save notification preferences.");
  });

  it("shows user selector when specific_user is selected", async () => {
    mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    expect(screen.queryByLabelText("Specific user selector")).not.toBeInTheDocument();

    const recipientSelect = screen.getByLabelText("Primary notification recipient");
    fireEvent.change(recipientSelect, { target: { value: "specific_user" } });

    expect(screen.getByLabelText("Specific user selector")).toBeInTheDocument();
    expect(screen.getByText("admin@test.com")).toBeInTheDocument();
    expect(screen.getByText("member@test.com")).toBeInTheDocument();
  });

  it("hides user selector when switching away from specific_user", async () => {
    mockFetchNotificationConfig.mockResolvedValue({
      ...DEFAULT_CONFIG,
      primaryRecipientType: "specific_user",
      specificRecipientUserId: "u-1"
    });
    await act(async () => {
      render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
    });

    expect(screen.getByLabelText("Specific user selector")).toBeInTheDocument();

    const recipientSelect = screen.getByLabelText("Primary notification recipient");
    fireEvent.change(recipientSelect, { target: { value: "all_tenant_admins" } });

    expect(screen.queryByLabelText("Specific user selector")).not.toBeInTheDocument();
  });

  describe("Notification Log", () => {
    it("renders notification log toggle", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      expect(screen.getByLabelText("Toggle notification log")).toBeInTheDocument();
    });

    it("loads and displays log events when expanded", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog.mockResolvedValue({
        items: [
          {
            _id: "evt-1",
            userId: "u-1",
            provider: "gmail",
            emailAddress: "inbox@example.com",
            eventType: "MAILBOX_NEEDS_REAUTH",
            reason: "token_expired",
            delivered: true,
            deliveryFailed: false,
            failureReason: null,
            skippedReason: null,
            recipient: "admin@test.com",
            retryCount: 0,
            createdAt: "2026-04-17T10:00:00.000Z"
          },
          {
            _id: "evt-2",
            userId: "u-2",
            provider: "gmail",
            emailAddress: "other@example.com",
            eventType: "MAILBOX_NEEDS_REAUTH",
            reason: "permission_revoked",
            delivered: false,
            deliveryFailed: true,
            failureReason: "SMTP connection refused",
            skippedReason: null,
            recipient: "member@test.com",
            retryCount: 3,
            createdAt: "2026-04-16T10:00:00.000Z"
          },
          {
            _id: "evt-3",
            userId: "u-1",
            provider: "gmail",
            emailAddress: "inbox@example.com",
            eventType: "MAILBOX_NEEDS_REAUTH",
            reason: "duplicate",
            delivered: false,
            deliveryFailed: true,
            failureReason: null,
            skippedReason: "duplicate_within_24h",
            recipient: null,
            retryCount: 0,
            createdAt: "2026-04-15T10:00:00.000Z"
          }
        ],
        page: 1,
        limit: 20,
        total: 3
      });

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      expect(mockFetchNotificationLog).toHaveBeenCalledWith(1);

      const badges = screen.getAllByTestId("status-badge");
      expect(badges[0]).toHaveTextContent("delivered");
      expect(badges[1]).toHaveTextContent("failed");
      expect(badges[2]).toHaveTextContent("skipped");

      expect(screen.getByText("admin@test.com")).toBeInTheDocument();
      expect(screen.getByText("SMTP connection refused")).toBeInTheDocument();
      expect(screen.getByText("duplicate_within_24h")).toBeInTheDocument();
    });

    it("shows empty state when no events exist", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog.mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0
      });

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      expect(screen.getByText("No notification events recorded yet.")).toBeInTheDocument();
    });

    it("shows pagination controls when multiple pages exist", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog.mockResolvedValue({
        items: [
          {
            _id: "evt-1",
            userId: "u-1",
            provider: "gmail",
            emailAddress: "test@example.com",
            eventType: "MAILBOX_NEEDS_REAUTH",
            reason: "token_expired",
            delivered: true,
            deliveryFailed: false,
            failureReason: null,
            skippedReason: null,
            recipient: "admin@test.com",
            retryCount: 0,
            createdAt: "2026-04-17T10:00:00.000Z"
          }
        ],
        page: 1,
        limit: 1,
        total: 3
      });

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
      expect(screen.getByText("Previous")).toBeDisabled();
      expect(screen.getByText("Next")).not.toBeDisabled();
    });

    it("navigates to next page", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog
        .mockResolvedValueOnce({
          items: [{
            _id: "evt-1", userId: "u-1", provider: "gmail", emailAddress: "t@e.com",
            eventType: "MAILBOX_NEEDS_REAUTH", reason: "r", delivered: true, deliveryFailed: false,
            failureReason: null, skippedReason: null, recipient: "a@t.com", retryCount: 0,
            createdAt: "2026-04-17T10:00:00.000Z"
          }],
          page: 1, limit: 1, total: 2
        })
        .mockResolvedValueOnce({
          items: [{
            _id: "evt-2", userId: "u-2", provider: "gmail", emailAddress: "o@e.com",
            eventType: "MAILBOX_NEEDS_REAUTH", reason: "r2", delivered: false, deliveryFailed: false,
            failureReason: null, skippedReason: null, recipient: "b@t.com", retryCount: 0,
            createdAt: "2026-04-16T10:00:00.000Z"
          }],
          page: 2, limit: 1, total: 2
        });

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      const nextBtn = screen.getByText("Next");
      await act(async () => { fireEvent.click(nextBtn); });

      expect(mockFetchNotificationLog).toHaveBeenCalledWith(2);
      expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    });

    it("shows log error with retry", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog.mockRejectedValue(new Error("Fetch failed"));

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      expect(screen.getByText("Fetch failed")).toBeInTheDocument();
    });

    it("renders pending status badge for undelivered non-failed events", async () => {
      mockFetchNotificationConfig.mockResolvedValue(DEFAULT_CONFIG);
      mockFetchNotificationLog.mockResolvedValue({
        items: [{
          _id: "evt-p",
          userId: "u-1",
          provider: "gmail",
          emailAddress: "test@example.com",
          eventType: "MAILBOX_NEEDS_REAUTH",
          reason: "pending",
          delivered: false,
          deliveryFailed: false,
          failureReason: null,
          skippedReason: null,
          recipient: "admin@test.com",
          retryCount: 1,
          createdAt: "2026-04-17T10:00:00.000Z"
        }],
        page: 1,
        limit: 20,
        total: 1
      });

      await act(async () => {
        render(<NotificationPreferencesSection tenantUsers={TENANT_USERS} />);
      });

      const logToggle = screen.getByLabelText("Toggle notification log");
      await act(async () => { fireEvent.click(logToggle); });

      const badges = screen.getAllByTestId("status-badge");
      expect(badges[0]).toHaveTextContent("pending");
    });
  });
});
