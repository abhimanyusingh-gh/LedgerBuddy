/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VirtualisedRows } from "@/components/virtualised/VirtualisedRows";

describe("components/virtualised/VirtualisedRows", () => {
  it("renders the empty content when there are no items", () => {
    render(
      <VirtualisedRows
        items={[]}
        rowHeight={40}
        height={200}
        rowKey={(_, index) => String(index)}
        renderRow={() => null}
        testId="virt"
        emptyContent={<span>nothing here</span>}
      />
    );
    expect(screen.getByText("nothing here")).toBeInTheDocument();
  });

  it("renders only a window of rows for very large lists (500+)", () => {
    const items = Array.from({ length: 750 }, (_, i) => ({ id: `r-${i}`, label: `row ${i}` }));
    render(
      <VirtualisedRows
        items={items}
        rowHeight={40}
        height={400}
        overscan={4}
        rowKey={(item) => item.id}
        renderRow={(item) => <span>{item.label}</span>}
        testId="virt"
      />
    );
    const container = screen.getByTestId("virt");
    const renderedCount = Number(container.dataset.renderedCount ?? "0");
    const totalCount = Number(container.dataset.totalCount ?? "0");
    expect(totalCount).toBe(750);
    expect(renderedCount).toBeGreaterThan(0);
    expect(renderedCount).toBeLessThan(40);
  });
});
