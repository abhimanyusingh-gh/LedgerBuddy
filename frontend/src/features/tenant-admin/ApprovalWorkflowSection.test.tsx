/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ApprovalWorkflowSection } from "./ApprovalWorkflowSection";
import type { ApprovalWorkflowConfig, TenantUser } from "@/types";

const mockFetchApprovalWorkflow = jest.fn();
const mockSaveApprovalWorkflow = jest.fn();
const mockFetchApprovalLimits = jest.fn();

jest.mock("@/api", () => ({
  fetchApprovalWorkflow: (...args: unknown[]) => mockFetchApprovalWorkflow(...args),
  saveApprovalWorkflow: (...args: unknown[]) => mockSaveApprovalWorkflow(...args),
}));

jest.mock("@/api/admin", () => ({
  fetchApprovalLimits: (...args: unknown[]) => mockFetchApprovalLimits(...args),
}));

const tenantUsers: TenantUser[] = [
  { userId: "u1", email: "alice@example.com", role: "ca", enabled: true },
  { userId: "u2", email: "bob@example.com", role: "senior_accountant", enabled: true },
];

const SIMPLE_CONFIG: ApprovalWorkflowConfig = {
  enabled: true,
  mode: "simple",
  simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
  steps: [],
};

const DISABLED_CONFIG: ApprovalWorkflowConfig = {
  enabled: false,
  mode: "simple",
  simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
  steps: [],
};

const ADVANCED_CONFIG: ApprovalWorkflowConfig = {
  enabled: true,
  mode: "advanced",
  simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
  steps: [
    { order: 1, name: "Step 1", approverType: "any_member", rule: "any", condition: null },
    { order: 2, name: "Step 2", approverType: "role", approverRole: "TENANT_ADMIN", rule: "all", condition: null },
  ],
};

const LIMITS_RESPONSE = {
  limits: {},
  complianceSignoffUsers: [
    { userId: "u1", role: "ca" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockFetchApprovalLimits.mockResolvedValue(LIMITS_RESPONSE);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ApprovalWorkflowSection", () => {
  describe("Loading state", () => {
    it("shows loading text before data loads", () => {
      mockFetchApprovalWorkflow.mockReturnValue(new Promise(() => {}));
      render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      expect(screen.getByText("Approval Workflow")).toBeInTheDocument();
      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });

    it("renders content after load completes", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(DISABLED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
      expect(screen.getByText("Require approval workflow")).toBeInTheDocument();
    });

  });

  describe("Empty users state", () => {
    it("shows hint to add team members when no users are passed", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(DISABLED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={[]} />);
      });
      expect(screen.getByText("Add team members before configuring approval workflows.")).toBeInTheDocument();
    });

  });

  describe("Simple mode", () => {
    it("renders simple mode options when enabled", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.getByText("Step 1: Approved by any team member")).toBeInTheDocument();
      expect(screen.getByText("Require manager review")).toBeInTheDocument();
      expect(screen.getByText("Require final sign-off")).toBeInTheDocument();
    });

    it("toggles enabled state via checkbox", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(DISABLED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.queryByText("Require manager review")).not.toBeInTheDocument();

      const checkbox = screen.getByRole("checkbox", { name: /Require approval workflow/i });
      fireEvent.click(checkbox);

      expect(screen.getByText("Require manager review")).toBeInTheDocument();
    });

    it("toggles requireManagerReview checkbox", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      const checkbox = screen.getByRole("checkbox", { name: /Require manager review/i });
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it("toggles requireFinalSignoff checkbox", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      const checkbox = screen.getByRole("checkbox", { name: /Require final sign-off/i });
      expect(checkbox).not.toBeChecked();
      fireEvent.click(checkbox);
      expect(checkbox).toBeChecked();
    });

  });

  describe("Switch to advanced mode", () => {
    it("switches to advanced mode and shows step cards", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByText(/Switch to Advanced Workflow/));
      expect(screen.getByText("+ Add Step")).toBeInTheDocument();
      expect(screen.getByText(/Back to Simple Mode/)).toBeInTheDocument();
    });

    it("seeds default step from simple config when switching", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByText(/Switch to Advanced Workflow/));
      expect(screen.getByText("Step 1")).toBeInTheDocument();
    });

    it("seeds manager review step when requireManagerReview is checked", async () => {
      const configWithManager: ApprovalWorkflowConfig = {
        ...SIMPLE_CONFIG,
        simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
      };
      mockFetchApprovalWorkflow.mockResolvedValue(configWithManager);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByText(/Switch to Advanced Workflow/));
      expect(screen.getByText("Step 1")).toBeInTheDocument();
      expect(screen.getByText("Step 2")).toBeInTheDocument();
    });

    it("switches back to simple mode", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(ADVANCED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.getByText("+ Add Step")).toBeInTheDocument();

      fireEvent.click(screen.getByText(/Back to Simple Mode/));
      expect(screen.queryByText("+ Add Step")).not.toBeInTheDocument();
      expect(screen.getByText("Require manager review")).toBeInTheDocument();
    });
  });

  describe("Advanced mode — step management", () => {
    it("adds a new step on click", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(ADVANCED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.queryByText("Step 3")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("+ Add Step"));
      expect(screen.getByText("Step 3")).toBeInTheDocument();
    });

    it("removes a step and renumbers remaining steps", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(ADVANCED_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });

      const removeButtons = screen.getAllByText("Remove");
      expect(removeButtons).toHaveLength(2);

      fireEvent.click(removeButtons[0]);
      expect(screen.queryByText("Step 2")).not.toBeInTheDocument();
      expect(screen.getByText("Step 1")).toBeInTheDocument();
    });

  });

  describe("Dirty state and save", () => {
    it("shows save button when config is changed", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /Require manager review/i }));
      expect(screen.getByText("Save Workflow")).toBeInTheDocument();
    });

    it("calls saveApprovalWorkflow on save click", async () => {
      const savedResult: ApprovalWorkflowConfig = {
        ...SIMPLE_CONFIG,
        simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
      };
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      mockSaveApprovalWorkflow.mockResolvedValue(savedResult);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /Require manager review/i }));
      await act(async () => {
        fireEvent.click(screen.getByText("Save Workflow"));
      });
      expect(mockSaveApprovalWorkflow).toHaveBeenCalledTimes(1);
    });

    it("shows error message on save failure", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      mockSaveApprovalWorkflow.mockRejectedValue(new Error("Server error"));
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /Require manager review/i }));
      await act(async () => {
        fireEvent.click(screen.getByText("Save Workflow"));
      });
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    it("shows Saving text while save is in progress", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      let resolvePromise: (v: ApprovalWorkflowConfig) => void;
      mockSaveApprovalWorkflow.mockReturnValue(
        new Promise<ApprovalWorkflowConfig>((resolve) => { resolvePromise = resolve; })
      );
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /Require manager review/i }));
      act(() => {
        fireEvent.click(screen.getByText("Save Workflow"));
      });
      expect(screen.getByText(/Saving/)).toBeInTheDocument();
      await act(async () => {
        resolvePromise!({
          ...SIMPLE_CONFIG,
          simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
        });
      });
    });

    it("hides save button after successful save resets dirty state", async () => {
      const savedResult: ApprovalWorkflowConfig = {
        ...SIMPLE_CONFIG,
        simpleConfig: { requireManagerReview: true, requireFinalSignoff: false },
      };
      mockFetchApprovalWorkflow.mockResolvedValue(SIMPLE_CONFIG);
      mockSaveApprovalWorkflow.mockResolvedValue(savedResult);
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /Require manager review/i }));
      expect(screen.getByText("Save Workflow")).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByText("Save Workflow"));
      });
      expect(screen.queryByText("Save Workflow")).not.toBeInTheDocument();
    });
  });

  describe("Compliance signoff users from approval limits", () => {
    it("passes compliance signoff users to step cards in advanced mode", async () => {
      mockFetchApprovalWorkflow.mockResolvedValue({
        ...ADVANCED_CONFIG,
        steps: [
          { order: 1, name: "Step 1", approverType: "any_member", rule: "any", condition: null, type: "compliance_signoff" },
        ],
      });
      await act(async () => {
        render(<ApprovalWorkflowSection tenantUsers={tenantUsers} />);
      });
      expect(screen.getByText("Eligible compliance sign-off users:")).toBeInTheDocument();
      expect(screen.getByText("alice@example.com (ca)")).toBeInTheDocument();
    });
  });
});
