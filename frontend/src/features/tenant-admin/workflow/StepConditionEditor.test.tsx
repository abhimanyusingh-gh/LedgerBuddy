/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StepConditionEditor } from "./StepConditionEditor";

beforeEach(() => jest.clearAllMocks());

describe("StepConditionEditor", () => {
  it("renders 'Always' when condition is null", () => {
    const onChange = jest.fn();
    render(<StepConditionEditor condition={null} onChange={onChange} />);

    const select = screen.getByLabelText("Condition:") as HTMLSelectElement;
    expect(select.value).toBe("none");
    expect(screen.queryByLabelText("Operator:")).not.toBeInTheDocument();
  });

  it("lists all 4 condition fields in the dropdown", () => {
    const onChange = jest.fn();
    render(<StepConditionEditor condition={null} onChange={onChange} />);

    const select = screen.getByLabelText("Condition:") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("none");
    expect(options).toContain("totalAmountMinor");
    expect(options).toContain("tdsAmountMinor");
    expect(options).toContain("riskSignalMaxSeverity");
    expect(options).toContain("glCodeSource");
  });

  it("shows numeric operators for totalAmountMinor", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "totalAmountMinor", operator: "gt", value: 5000000 }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:") as HTMLSelectElement;
    const operators = Array.from(operatorSelect.options).map((o) => o.value);
    expect(operators).toEqual(["gt", "gte", "lt", "lte", "eq"]);
  });

  it("shows numeric operators for tdsAmountMinor", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "tdsAmountMinor", operator: "gte", value: 100000 }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:") as HTMLSelectElement;
    const operators = Array.from(operatorSelect.options).map((o) => o.value);
    expect(operators).toEqual(["gt", "gte", "lt", "lte", "eq"]);
  });

  it("shows threshold input for totalAmountMinor in major units", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "totalAmountMinor", operator: "gt", value: 5000000 }}
        onChange={onChange}
      />
    );

    const input = screen.getByLabelText(/Threshold/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("50000");
  });

  it("shows threshold input for tdsAmountMinor", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "tdsAmountMinor", operator: "gt", value: 100000 }}
        onChange={onChange}
      />
    );

    const input = screen.getByLabelText(/Threshold/) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.value).toBe("1000");
  });

  it("converts threshold input from major to minor units on change", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "totalAmountMinor", operator: "gt", value: 5000000 }}
        onChange={onChange}
      />
    );

    const input = screen.getByLabelText(/Threshold/);
    fireEvent.change(input, { target: { value: "75000" } });
    expect(onChange).toHaveBeenCalledWith({ field: "totalAmountMinor", operator: "gt", value: 7500000 });
  });

  it("shows string operators for riskSignalMaxSeverity", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "riskSignalMaxSeverity", operator: "eq", value: "critical" }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:") as HTMLSelectElement;
    const operators = Array.from(operatorSelect.options).map((o) => o.value);
    expect(operators).toEqual(["eq", "in"]);
  });

  it("shows severity dropdown for riskSignalMaxSeverity", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "riskSignalMaxSeverity", operator: "eq", value: "warning" }}
        onChange={onChange}
      />
    );

    const severitySelect = screen.getByLabelText("Severity:") as HTMLSelectElement;
    expect(severitySelect.value).toBe("warning");
    const options = Array.from(severitySelect.options).map((o) => o.value);
    expect(options).toEqual(["info", "warning", "critical"]);
  });

  it("does not show threshold input for riskSignalMaxSeverity", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "riskSignalMaxSeverity", operator: "eq", value: "critical" }}
        onChange={onChange}
      />
    );

    expect(screen.queryByLabelText(/Threshold/)).not.toBeInTheDocument();
  });

  it("shows string operators for glCodeSource", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "glCodeSource", operator: "eq", value: "manual" }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:") as HTMLSelectElement;
    const operators = Array.from(operatorSelect.options).map((o) => o.value);
    expect(operators).toEqual(["eq", "in"]);
  });

  it("shows single-select source dropdown for glCodeSource with eq operator", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "glCodeSource", operator: "eq", value: "auto" }}
        onChange={onChange}
      />
    );

    const sourceSelect = screen.getByLabelText("Source:") as HTMLSelectElement;
    expect(sourceSelect.value).toBe("auto");
    const options = Array.from(sourceSelect.options).map((o) => o.value);
    expect(options).toEqual(["manual", "auto", "override"]);
  });

  it("shows multi-select source dropdown for glCodeSource with in operator", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "glCodeSource", operator: "in", value: ["manual", "auto"] }}
        onChange={onChange}
      />
    );

    const sourcesSelect = screen.getByLabelText("Sources:") as HTMLSelectElement;
    expect(sourcesSelect.multiple).toBe(true);
  });

  it("calls onChange with null when selecting Always", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "totalAmountMinor", operator: "gt", value: 5000000 }}
        onChange={onChange}
      />
    );

    const select = screen.getByLabelText("Condition:");
    fireEvent.change(select, { target: { value: "none" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("sets default values when switching field to riskSignalMaxSeverity", () => {
    const onChange = jest.fn();
    render(<StepConditionEditor condition={null} onChange={onChange} />);

    const select = screen.getByLabelText("Condition:");
    fireEvent.change(select, { target: { value: "riskSignalMaxSeverity" } });
    expect(onChange).toHaveBeenCalledWith({
      field: "riskSignalMaxSeverity",
      operator: "eq",
      value: "critical",
    });
  });

  it("sets default values when switching field to glCodeSource", () => {
    const onChange = jest.fn();
    render(<StepConditionEditor condition={null} onChange={onChange} />);

    const select = screen.getByLabelText("Condition:");
    fireEvent.change(select, { target: { value: "glCodeSource" } });
    expect(onChange).toHaveBeenCalledWith({
      field: "glCodeSource",
      operator: "eq",
      value: "manual",
    });
  });

  it("sets default values when switching field to totalAmountMinor", () => {
    const onChange = jest.fn();
    render(<StepConditionEditor condition={null} onChange={onChange} />);

    const select = screen.getByLabelText("Condition:");
    fireEvent.change(select, { target: { value: "totalAmountMinor" } });
    expect(onChange).toHaveBeenCalledWith({
      field: "totalAmountMinor",
      operator: "gt",
      value: 5000000,
    });
  });

  it("converts scalar value to array when switching from eq to in operator", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "glCodeSource", operator: "eq", value: "manual" }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:");
    fireEvent.change(operatorSelect, { target: { value: "in" } });
    expect(onChange).toHaveBeenCalledWith({
      field: "glCodeSource",
      operator: "in",
      value: ["manual"],
    });
  });

  it("converts array value to scalar when switching from in to eq operator", () => {
    const onChange = jest.fn();
    render(
      <StepConditionEditor
        condition={{ field: "glCodeSource", operator: "in", value: ["manual", "auto"] }}
        onChange={onChange}
      />
    );

    const operatorSelect = screen.getByLabelText("Operator:");
    fireEvent.change(operatorSelect, { target: { value: "eq" } });
    expect(onChange).toHaveBeenCalledWith({
      field: "glCodeSource",
      operator: "eq",
      value: "manual",
    });
  });
});
