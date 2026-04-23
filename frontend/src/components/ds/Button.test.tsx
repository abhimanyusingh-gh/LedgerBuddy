/**
 * @jest-environment jsdom
 */
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Button } from "@/components/ds/Button";

describe("ds/Button", () => {
  it("renders children, defaults to primary + type=button, fires onClick", () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveClass("app-button", "app-button-primary");
    expect(btn.getAttribute("type")).toBe("button");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("applies variant, size, and custom className", () => {
    render(
      <Button variant="secondary" size="sm" className="foo">
        Cancel
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Cancel" });
    expect(btn).toHaveClass(
      "app-button",
      "app-button-secondary",
      "app-button-sm",
      "foo"
    );
  });

  it("destructive variant applies warn colour inline, ghost variant clears background", () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    let btn = screen.getByRole("button");
    expect(btn.style.background).toBe("var(--warn)");
    expect(btn.style.borderColor).toBe("var(--warn)");

    rerender(<Button variant="ghost">Dismiss</Button>);
    btn = screen.getByRole("button");
    expect(btn.style.background).toBe("transparent");
  });

  it("loading state: disables, sets aria-busy, applies loading class", () => {
    const onClick = jest.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("app-button-loading");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled state is respected independently of loading", () => {
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("aria-busy")).toBeNull();
  });

  it("renders icon with aria-hidden and forwards refs + extra props", () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} icon="check" data-testid="b" type="submit">
        Confirm
      </Button>
    );
    const btn = screen.getByTestId("b");
    expect(ref.current).toBe(btn);
    expect(btn.getAttribute("type")).toBe("submit");
    const icon = btn.querySelector(".material-symbols-outlined");
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.textContent).toBe("check");
  });
});
