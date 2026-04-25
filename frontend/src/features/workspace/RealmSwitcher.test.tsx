/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RealmSwitcher } from "@/features/workspace/RealmSwitcher";
import {
  ACTIVE_CLIENT_ORG_STORAGE_KEY,
  setActiveClientOrgId
} from "@/hooks/useActiveClientOrg";

function clearActiveRealm() {
  window.history.replaceState({}, "", "/");
  window.sessionStorage.clear();
}

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof RealmSwitcher>> = {}) {
  const props: React.ComponentProps<typeof RealmSwitcher> = {
    open: true,
    onClose: jest.fn(),
    clientOrgs: [
      { id: "org-1", companyName: "Sharma Textiles" },
      { id: "org-2", companyName: "Bose Steel" },
      { id: "org-3", companyName: "Bharti Logistics" }
    ],
    isLoading: false,
    isError: false,
    onRetry: jest.fn(),
    ...overrides
  };
  return { props, ...render(<RealmSwitcher {...props} />) };
}

describe("RealmSwitcher", () => {
  beforeEach(clearActiveRealm);
  afterEach(clearActiveRealm);

  it("returns null when closed", () => {
    renderSwitcher({ open: false });
    expect(screen.queryByTestId("realm-switcher-overlay")).not.toBeInTheDocument();
  });

  it("renders the data state with all orgs as listbox options", () => {
    renderSwitcher();
    const list = screen.getByTestId("realm-switcher-list");
    expect(list).toHaveAttribute("role", "listbox");
    expect(screen.getByTestId("realm-switcher-option-org-1")).toHaveTextContent("Sharma Textiles");
    expect(screen.getByTestId("realm-switcher-option-org-2")).toHaveTextContent("Bose Steel");
    expect(screen.getByTestId("realm-switcher-option-org-3")).toHaveTextContent("Bharti Logistics");
  });

  it("renders loading state", () => {
    renderSwitcher({ clientOrgs: undefined, isLoading: true });
    expect(screen.getByTestId("realm-switcher-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("realm-switcher-list")).not.toBeInTheDocument();
  });

  it("renders error state with a retry button that calls onRetry", () => {
    const onRetry = jest.fn();
    renderSwitcher({ clientOrgs: undefined, isError: true, onRetry });
    const errorBanner = screen.getByTestId("realm-switcher-error");
    expect(errorBanner).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders empty state and the onboarding CTA when provided", () => {
    const onGoToOnboarding = jest.fn();
    const onClose = jest.fn();
    renderSwitcher({ clientOrgs: [], onGoToOnboarding, onClose });
    expect(screen.getByTestId("realm-switcher-empty")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /go to onboarding/i }));
    expect(onGoToOnboarding).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders empty state without an onboarding CTA when no handler is provided", () => {
    renderSwitcher({ clientOrgs: [] });
    expect(screen.getByTestId("realm-switcher-empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /go to onboarding/i })).not.toBeInTheDocument();
  });

  it("filters options by typing in the search input (case-insensitive partial match)", () => {
    renderSwitcher();
    const input = screen.getByTestId("realm-switcher-input");
    fireEvent.change(input, { target: { value: "bo" } });
    expect(screen.getByTestId("realm-switcher-option-org-2")).toBeInTheDocument();
    expect(screen.queryByTestId("realm-switcher-option-org-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("realm-switcher-option-org-3")).not.toBeInTheDocument();
  });

  it("shows no-match message when typeahead returns zero", () => {
    renderSwitcher();
    fireEvent.change(screen.getByTestId("realm-switcher-input"), { target: { value: "xyz" } });
    expect(screen.getByTestId("realm-switcher-no-match")).toBeInTheDocument();
    expect(screen.queryByTestId("realm-switcher-list")).not.toBeInTheDocument();
  });

  it("marks the active realm with aria-selected and a check indicator", () => {
    setActiveClientOrgId("org-2");
    renderSwitcher();
    const activeOption = screen.getByTestId("realm-switcher-option-org-2");
    expect(activeOption).toHaveAttribute("aria-selected", "true");
    expect(activeOption).toHaveAttribute("data-active", "true");
  });

  it("commits the highlighted option on Enter and writes activeClientOrgId", () => {
    const onClose = jest.fn();
    renderSwitcher({ onClose });
    const input = screen.getByTestId("realm-switcher-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("org-2");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps highlight on ArrowDown past the last option", () => {
    renderSwitcher();
    const input = screen.getByTestId("realm-switcher-input");
    // Start at index 0 (org-1). 3 ArrowDowns wraps back to index 0.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("org-1");
  });

  it("wraps highlight on ArrowUp from the first option to the last", () => {
    renderSwitcher();
    const input = screen.getByTestId("realm-switcher-input");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("org-3");
  });

  it("commits the clicked option on mouse click", () => {
    const onClose = jest.fn();
    renderSwitcher({ onClose });
    fireEvent.click(screen.getByTestId("realm-switcher-option-org-3"));
    expect(window.sessionStorage.getItem(ACTIVE_CLIENT_ORG_STORAGE_KEY)).toBe("org-3");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape key", () => {
    const onClose = jest.fn();
    renderSwitcher({ onClose });
    fireEvent.keyDown(screen.getByTestId("realm-switcher-input"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on overlay click but not on dialog click", () => {
    const onClose = jest.fn();
    renderSwitcher({ onClose });
    fireEvent.click(screen.getByTestId("realm-switcher-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wires aria-controls and aria-activedescendant on the input", () => {
    renderSwitcher();
    const input = screen.getByTestId("realm-switcher-input");
    const list = screen.getByTestId("realm-switcher-list");
    expect(input).toHaveAttribute("aria-controls", list.getAttribute("id"));
    expect(input).toHaveAttribute("aria-activedescendant");
    const activeDescendant = input.getAttribute("aria-activedescendant");
    expect(activeDescendant).toBe(`${list.getAttribute("id")}-option-org-1`);
  });
});
