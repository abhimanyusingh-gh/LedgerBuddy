/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VendorMsmeSection } from "./VendorMsmeSection";

const mockFetchVendors = jest.fn();
const mockUpdateVendorMsme = jest.fn();

jest.mock("@/api/vendors", () => ({
  fetchVendors: (...args: unknown[]) => mockFetchVendors(...args),
  updateVendorMsme: (...args: unknown[]) => mockUpdateVendorMsme(...args),
}));

const msmeVendors = [
  {
    _id: "v1",
    name: "Micro Industries Pvt Ltd",
    pan: "AABCM1234A",
    gstin: null,
    msme: { classification: "micro", agreedPaymentDays: 30 },
    invoiceCount: 5,
    lastInvoiceDate: new Date(Date.now() - 20 * 86400000).toISOString(),
  },
  {
    _id: "v2",
    name: "Small Solutions Ltd",
    pan: null,
    gstin: null,
    msme: { classification: "small", agreedPaymentDays: null },
    invoiceCount: 3,
    lastInvoiceDate: new Date(Date.now() - 50 * 86400000).toISOString(),
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchVendors.mockResolvedValue({ items: msmeVendors, page: 1, limit: 50, total: 2 });
  mockUpdateVendorMsme.mockResolvedValue({});
});

describe("VendorMsmeSection", () => {
  it("renders MSME vendor list", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    expect(screen.getByText("Small Solutions Ltd")).toBeInTheDocument();
  });

  it("shows statutory limit note", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Statutory limit: 45 days (MSMED Act). Agreed terms cannot exceed this.")).toBeInTheDocument();
    });
  });

  it("shows empty state when no MSME vendors exist", async () => {
    mockFetchVendors.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0 });
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("No MSME vendors")).toBeInTheDocument();
    });
  });

  it("shows edit button for each vendor", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      const editButtons = screen.getAllByText("Edit");
      expect(editButtons).toHaveLength(2);
    });
  });

  it("enters edit mode when Edit is clicked", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    const editButtons = screen.getAllByText("Edit");
    fireEvent.click(editButtons[0]);
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("cancels edit mode", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText("Edit")[0]);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
  });

  it("saves updated payment days", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText("Edit")[0]);
    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(mockUpdateVendorMsme).toHaveBeenCalledWith("v1", 35);
    });
  });

  it("shows error for invalid payment days", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText("Edit")[0]);
    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(screen.getByText("Payment days must be a whole number between 1 and 365.")).toBeInTheDocument();
    });
    expect(mockUpdateVendorMsme).not.toHaveBeenCalled();
  });

  it("shows capped indicator when agreed days exceed 45", async () => {
    const vendorsWithExcess = [{
      ...msmeVendors[0],
      msme: { classification: "micro", agreedPaymentDays: 60 },
    }];
    mockFetchVendors.mockResolvedValue({ items: vendorsWithExcess, page: 1, limit: 50, total: 1 });
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("(capped at 45)")).toBeInTheDocument();
    });
  });

  it("displays agreed payment days for vendor with value set", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("30")).toBeInTheDocument();
    });
  });

  it("displays dash for vendor without agreed payment days", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      const cells = document.querySelectorAll("td");
      const agreedDaysCells = Array.from(cells).filter(td => td.textContent === "-");
      expect(agreedDaysCells.length).toBeGreaterThan(0);
    });
  });

  it("fetches vendors with hasMsme filter", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(mockFetchVendors).toHaveBeenCalledWith({ hasMsme: true });
    });
  });

  it("sends null when clearing payment days", async () => {
    render(<VendorMsmeSection />);
    await waitFor(() => {
      expect(screen.getByText("Micro Industries Pvt Ltd")).toBeInTheDocument();
    });
    fireEvent.click(screen.getAllByText("Edit")[0]);
    const input = document.querySelector("input[type='number']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(mockUpdateVendorMsme).toHaveBeenCalledWith("v1", null);
    });
  });
});
