/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ClientOrgPicker } from "@/features/triage/ClientOrgPicker";

function renderPicker(overrides: Partial<React.ComponentProps<typeof ClientOrgPicker>> = {}) {
  const onSelect = jest.fn();
  const onClose = jest.fn();
  const onRetry = jest.fn();
  const props: React.ComponentProps<typeof ClientOrgPicker> = {
    open: true,
    onClose,
    onSelect,
    clientOrgs: [
      { id: "org-1", companyName: "Sharma Textiles" },
      { id: "org-2", companyName: "Bose Steel" },
      { id: "org-3", companyName: "Bharti Logistics" }
    ],
    isLoading: false,
    isError: false,
    onRetry,
    testIdPrefix: "tp",
    ...overrides
  };
  return { onSelect, onClose, onRetry, props, ...render(<ClientOrgPicker {...props} />) };
}

describe("features/triage/ClientOrgPicker — 4-state contract", () => {
  it("renders nothing when closed", () => {
    renderPicker({ open: false });
    expect(screen.queryByTestId("tp-overlay")).not.toBeInTheDocument();
  });

  it("renders the loading state", () => {
    renderPicker({ clientOrgs: undefined, isLoading: true });
    expect(screen.getByTestId("tp-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("tp-list")).not.toBeInTheDocument();
  });

  it("renders the error state with a retry button that fires onRetry", () => {
    const { onRetry } = renderPicker({ clientOrgs: undefined, isError: true });
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when the tenant has no clients", () => {
    renderPicker({ clientOrgs: [], emptyHelpText: "Onboard a client first." });
    const empty = screen.getByTestId("tp-empty");
    expect(empty).toHaveTextContent("Onboard a client first.");
  });

  it("renders the data list with all options as listbox rows", () => {
    renderPicker();
    expect(screen.getByTestId("tp-list")).toHaveAttribute("role", "listbox");
    expect(screen.getByTestId("tp-option-org-1")).toBeInTheDocument();
    expect(screen.getByTestId("tp-option-org-2")).toBeInTheDocument();
    expect(screen.getByTestId("tp-option-org-3")).toBeInTheDocument();
  });
});

describe("features/triage/ClientOrgPicker — typeahead + keyboard", () => {
  it("filters options case-insensitively", () => {
    renderPicker();
    fireEvent.change(screen.getByTestId("tp-input"), { target: { value: "bo" } });
    expect(screen.queryByTestId("tp-option-org-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("tp-option-org-2")).toBeInTheDocument();
  });

  it("shows the no-match status when typeahead returns zero", () => {
    renderPicker();
    fireEvent.change(screen.getByTestId("tp-input"), { target: { value: "xyz" } });
    expect(screen.getByTestId("tp-no-match")).toBeInTheDocument();
  });

  it("commits onSelect via Enter on the highlighted option", () => {
    const { onSelect } = renderPicker();
    const input = screen.getByTestId("tp-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ id: "org-2", companyName: "Bose Steel" });
  });

  it("wraps highlight on ArrowUp from first to last", () => {
    const { onSelect } = renderPicker();
    fireEvent.keyDown(screen.getByTestId("tp-input"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByTestId("tp-input"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ id: "org-3", companyName: "Bharti Logistics" });
  });
});

describe("features/triage/ClientOrgPicker — suggested heuristic", () => {
  it("surfaces suggested orgs at the top with a Suggested badge", () => {
    renderPicker({
      suggested: [{ id: "org-2", companyName: "Bose Steel" }]
    });
    const list = screen.getByTestId("tp-list");
    const options = list.querySelectorAll("li");
    expect(options[0].getAttribute("data-suggested")).toBe("true");
    expect(options[0].textContent).toContain("Bose Steel");
    expect(screen.getByTestId("tp-suggested-badge-org-2")).toBeInTheDocument();
  });

});
