/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MissingRealmBoundary } from "@/components/common/MissingRealmBoundary";
import { MissingActiveClientOrgError } from "@/api/errors";

function ThrowMissingRealm(): JSX.Element {
  throw new MissingActiveClientOrgError("/invoices");
}

function ThrowGeneric(): JSX.Element {
  throw new Error("unrelated boom");
}

describe("MissingRealmBoundary", () => {
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const unhandledRejections: unknown[] = [];
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandledRejections.push(event.reason);
  };

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    unhandledRejections.length = 0;
    window.addEventListener("unhandledrejection", onUnhandled);
  });

  afterEach(() => {
    window.removeEventListener("unhandledrejection", onUnhandled);
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("renders children when no error occurs", () => {
    render(
      <MissingRealmBoundary>
        <p>Inner content</p>
      </MissingRealmBoundary>
    );
    expect(screen.getByText("Inner content")).toBeInTheDocument();
  });

  it("renders the 'select a realm' overlay when MissingActiveClientOrgError is thrown", () => {
    render(
      <MissingRealmBoundary>
        <ThrowMissingRealm />
      </MissingRealmBoundary>
    );
    expect(screen.getByTestId("missing-realm-overlay")).toBeInTheDocument();
    expect(screen.getByText(/Select a client to continue/)).toBeInTheDocument();
    // No unhandled-rejection warnings should leak from the boundary path.
    expect(unhandledRejections).toEqual([]);
  });

  it("re-throws non-MissingActiveClientOrgError errors so the outer boundary handles them", () => {
    // The component throws a generic Error — getDerivedStateFromError returns
    // null for non-realm errors, so React continues bubbling. We assert by
    // observing that the overlay does NOT render and the inner subtree is
    // unmounted (React unmounts on uncaught render errors).
    expect(() =>
      render(
        <MissingRealmBoundary>
          <ThrowGeneric />
        </MissingRealmBoundary>
      )
    ).toThrow(/unrelated boom/);
    expect(screen.queryByTestId("missing-realm-overlay")).not.toBeInTheDocument();
  });
});
