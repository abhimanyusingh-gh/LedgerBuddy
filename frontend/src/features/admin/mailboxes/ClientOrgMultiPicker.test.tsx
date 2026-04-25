/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ClientOrgMultiPicker } from "@/features/admin/mailboxes/ClientOrgMultiPicker";

const ORGS = [
  { id: "org-1", companyName: "Sharma Textiles" },
  { id: "org-2", companyName: "Bose Steel" },
  { id: "org-3", companyName: "Acme Industries" }
];

describe("features/admin/mailboxes/ClientOrgMultiPicker", () => {
  it("renders the loading state when isLoading=true", () => {
    render(
      <ClientOrgMultiPicker
        clientOrgs={undefined}
        isLoading
        isError={false}
        onRetry={jest.fn()}
        selectedIds={[]}
        onChange={jest.fn()}
      />
    );
    expect(screen.getByTestId("client-org-multi-picker-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("client-org-multi-picker-list")).not.toBeInTheDocument();
  });

  it("renders the error state with a retry button", () => {
    const onRetry = jest.fn();
    render(
      <ClientOrgMultiPicker
        clientOrgs={undefined}
        isLoading={false}
        isError
        onRetry={onRetry}
        selectedIds={[]}
        onChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("sorts options ascending by companyName and toggles selection by id", () => {
    const onChange = jest.fn();
    render(
      <ClientOrgMultiPicker
        clientOrgs={ORGS}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        selectedIds={["org-2"]}
        onChange={onChange}
      />
    );
    const options = screen.getAllByRole("option");
    expect(options.map((node) => node.textContent)).toEqual([
      "Acme Industries",
      "Bose Steel",
      "Sharma Textiles"
    ]);

    // Adding an unselected org appends it.
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-1"));
    expect(onChange).toHaveBeenLastCalledWith(["org-2", "org-1"]);

    // Toggling an already-selected org removes it.
    fireEvent.click(screen.getByTestId("client-org-multi-picker-checkbox-org-2"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("filters by case-insensitive substring on companyName", () => {
    render(
      <ClientOrgMultiPicker
        clientOrgs={ORGS}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        selectedIds={[]}
        onChange={jest.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("client-org-multi-picker-input"), {
      target: { value: "STEEL" }
    });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Bose Steel");
  });

  it("renders selected chips and emits onChange when chip remove is clicked", () => {
    const onChange = jest.fn();
    render(
      <ClientOrgMultiPicker
        clientOrgs={ORGS}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        selectedIds={["org-1", "org-2"]}
        onChange={onChange}
      />
    );
    expect(screen.getByTestId("client-org-multi-picker-chip-org-1")).toBeInTheDocument();
    expect(screen.getByTestId("client-org-multi-picker-chip-org-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("client-org-multi-picker-chip-remove-org-1"));
    expect(onChange).toHaveBeenCalledWith(["org-2"]);
  });

  it("uses listbox-only a11y semantics — no nested native checkbox inputs in the option rows", () => {
    render(
      <ClientOrgMultiPicker
        clientOrgs={ORGS}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        selectedIds={["org-1"]}
        onChange={jest.fn()}
      />
    );
    const list = screen.getByTestId("client-org-multi-picker-list");
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("aria-multiselectable", "true");
    expect(list.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    const selectedOption = screen.getByTestId("client-org-multi-picker-option-org-1");
    expect(selectedOption).toHaveAttribute("aria-selected", "true");
  });

  describe("keyboard a11y (aria-activedescendant listbox)", () => {
    function renderPicker(onChange = jest.fn()) {
      render(
        <ClientOrgMultiPicker
          clientOrgs={ORGS}
          isLoading={false}
          isError={false}
          onRetry={jest.fn()}
          selectedIds={[]}
          onChange={onChange}
        />
      );
      return onChange;
    }

    it("makes the listbox tab-reachable with tabIndex=0", () => {
      renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      expect(list).toHaveAttribute("tabindex", "0");
    });

    it("ArrowDown advances aria-activedescendant to the next option", () => {
      renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      const firstOptionId = screen.getByTestId("client-org-multi-picker-option-org-3").id;
      const secondOptionId = screen.getByTestId("client-org-multi-picker-option-org-2").id;
      expect(list).toHaveAttribute("aria-activedescendant", firstOptionId);
      fireEvent.keyDown(list, { key: "ArrowDown" });
      expect(list).toHaveAttribute("aria-activedescendant", secondOptionId);
    });

    it("ArrowUp moves aria-activedescendant to the previous option (wraps from first to last)", () => {
      renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      const lastOptionId = screen.getByTestId("client-org-multi-picker-option-org-1").id;
      fireEvent.keyDown(list, { key: "ArrowUp" });
      expect(list).toHaveAttribute("aria-activedescendant", lastOptionId);
    });

    it("Home/End jump to first/last option", () => {
      renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      const firstOptionId = screen.getByTestId("client-org-multi-picker-option-org-3").id;
      const lastOptionId = screen.getByTestId("client-org-multi-picker-option-org-1").id;
      fireEvent.keyDown(list, { key: "End" });
      expect(list).toHaveAttribute("aria-activedescendant", lastOptionId);
      fireEvent.keyDown(list, { key: "Home" });
      expect(list).toHaveAttribute("aria-activedescendant", firstOptionId);
    });

    it("Space toggles the active option's selection", () => {
      const onChange = renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      fireEvent.keyDown(list, { key: " " });
      expect(onChange).toHaveBeenLastCalledWith(["org-3"]);
    });

    it("Enter toggles the active option's selection", () => {
      const onChange = renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      fireEvent.keyDown(list, { key: "ArrowDown" });
      fireEvent.keyDown(list, { key: "Enter" });
      expect(onChange).toHaveBeenLastCalledWith(["org-2"]);
    });

    it("does not toggle a non-active option when Space is pressed at the listbox level", () => {
      const onChange = renderPicker();
      const list = screen.getByTestId("client-org-multi-picker-list");
      fireEvent.keyDown(list, { key: " " });
      // Active option is org-3 (Acme Industries, sorted first); org-1 must NOT be selected.
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalledWith(expect.arrayContaining(["org-1"]));
    });
  });

  it("flags chips for ids that are no longer in the tenant's clientOrgs as orphans", () => {
    render(
      <ClientOrgMultiPicker
        clientOrgs={ORGS}
        isLoading={false}
        isError={false}
        onRetry={jest.fn()}
        selectedIds={["org-99"]}
        onChange={jest.fn()}
      />
    );
    const chip = screen.getByTestId("client-org-multi-picker-chip-org-99");
    expect(chip).toHaveAttribute("data-orphan", "true");
    expect(chip).toHaveTextContent(/removed/i);
  });
});
