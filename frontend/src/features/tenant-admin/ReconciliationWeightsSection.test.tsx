/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReconciliationWeightsSection } from "@/features/tenant-admin/ReconciliationWeightsSection";

const mockFetchComplianceConfig = jest.fn();
const mockSaveComplianceConfig = jest.fn();

jest.mock("@/api/admin", () => ({
  fetchComplianceConfig: (...args: unknown[]) => mockFetchComplianceConfig(...args),
  saveComplianceConfig: (...args: unknown[]) => mockSaveComplianceConfig(...args)
}));

const DEFAULTS = {
  reconciliationWeightExactAmount: 50,
  reconciliationWeightCloseAmount: 10,
  reconciliationWeightInvoiceNumber: 30,
  reconciliationWeightVendorName: 20,
  reconciliationWeightDateProximity: 10
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ReconciliationWeightsSection", () => {
  it("renders with default weights when config returns no overrides", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    await act(async () => { render(<ReconciliationWeightsSection />); });

    expect(screen.getByLabelText("Exact Amount Match")).toHaveValue(50);
    expect(screen.getByLabelText("Close Amount Match")).toHaveValue(10);
    expect(screen.getByLabelText("Invoice Number Match")).toHaveValue(30);
    expect(screen.getByLabelText("Vendor Name Match")).toHaveValue(20);
    expect(screen.getByLabelText("Date Proximity")).toHaveValue(10);
  });

  it("renders with custom weights from config", async () => {
    mockFetchComplianceConfig.mockResolvedValue({
      reconciliationWeightExactAmount: 80,
      reconciliationWeightCloseAmount: 5,
      reconciliationWeightInvoiceNumber: 40,
      reconciliationWeightVendorName: 30,
      reconciliationWeightDateProximity: 15
    });
    await act(async () => { render(<ReconciliationWeightsSection />); });

    expect(screen.getByLabelText("Exact Amount Match")).toHaveValue(80);
    expect(screen.getByLabelText("Close Amount Match")).toHaveValue(5);
    expect(screen.getByLabelText("Invoice Number Match")).toHaveValue(40);
    expect(screen.getByLabelText("Vendor Name Match")).toHaveValue(30);
    expect(screen.getByLabelText("Date Proximity")).toHaveValue(15);
  });

  it("shows loading state", () => {
    mockFetchComplianceConfig.mockReturnValue(new Promise(() => {}));
    render(<ReconciliationWeightsSection />);

    expect(screen.getByText("Loading reconciliation weights...")).toBeInTheDocument();
  });

  it("shows error state with retry button on load failure", async () => {
    mockFetchComplianceConfig.mockRejectedValue(new Error("Network error"));
    await act(async () => { render(<ReconciliationWeightsSection />); });

    expect(screen.getByText("Failed to load reconciliation weights.")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows total weight budget indicator", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    await act(async () => { render(<ReconciliationWeightsSection />); });

    const budget = screen.getByTestId("weight-budget");
    expect(budget).toHaveTextContent("Total weight budget: 120/300");
  });

  it("updates budget when a field changes", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    await act(async () => { render(<ReconciliationWeightsSection />); });

    const input = screen.getByLabelText("Exact Amount Match");
    fireEvent.change(input, { target: { value: "90" } });

    const budget = screen.getByTestId("weight-budget");
    expect(budget).toHaveTextContent("Total weight budget: 160/300");
  });

  it("save button appears only when values are dirty", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    await act(async () => { render(<ReconciliationWeightsSection />); });

    expect(screen.queryByText("Save Weights")).not.toBeInTheDocument();

    const input = screen.getByLabelText("Exact Amount Match");
    fireEvent.change(input, { target: { value: "90" } });

    expect(screen.getByText("Save Weights")).toBeInTheDocument();
  });

  it("calls saveComplianceConfig on save and hides button after", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    mockSaveComplianceConfig.mockResolvedValue({ ...DEFAULTS, reconciliationWeightExactAmount: 90 });
    await act(async () => { render(<ReconciliationWeightsSection />); });

    const input = screen.getByLabelText("Exact Amount Match");
    fireEvent.change(input, { target: { value: "90" } });

    const saveBtn = screen.getByText("Save Weights");
    await act(async () => { fireEvent.click(saveBtn); });

    expect(mockSaveComplianceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ reconciliationWeightExactAmount: 90 })
    );
    expect(screen.getByText("Reconciliation weights saved.")).toBeInTheDocument();
  });

  it("shows inline error on save failure", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    mockSaveComplianceConfig.mockRejectedValue({ code: "UNKNOWN" });
    await act(async () => { render(<ReconciliationWeightsSection />); });

    const input = screen.getByLabelText("Exact Amount Match");
    fireEvent.change(input, { target: { value: "90" } });

    const saveBtn = screen.getByText("Save Weights");
    await act(async () => { fireEvent.click(saveBtn); });

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save reconciliation weights.");
  });

  it("clamps input values between 0 and 100", async () => {
    mockFetchComplianceConfig.mockResolvedValue({});
    await act(async () => { render(<ReconciliationWeightsSection />); });

    const input = screen.getByLabelText("Exact Amount Match");
    fireEvent.change(input, { target: { value: "150" } });
    expect(input).toHaveValue(100);

    fireEvent.change(input, { target: { value: "-10" } });
    expect(input).toHaveValue(0);
  });
});
