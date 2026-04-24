import { useState } from "react";
import type { SlideOverPanelProps } from "./SlideOverPanel";
import { SlideOverPanel } from "./SlideOverPanel";
import { Button } from "./Button";

type Story = { name: string; render: () => JSX.Element };

const meta = {
  title: "ds/SlideOverPanel",
  component: SlideOverPanel
} as const;
export default meta;

function Demo(props: Omit<SlideOverPanelProps, "open" | "onClose" | "children"> & { body?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { body, ...rest } = props;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open panel</Button>
      <SlideOverPanel {...rest} open={open} onClose={() => setOpen(false)}>
        {body ?? (
          <p>
            This is the default slot content. Consumers (FE-5a Action-Required queue,
            FE-5b pre-export validation) render their own table/list/form here.
          </p>
        )}
      </SlideOverPanel>
    </>
  );
}

export const DefaultRight: Story = {
  name: "Right side, medium width",
  render: () => <Demo title="Action Required (3)" />
};

export const Narrow: Story = {
  name: "Narrow (sm) with footer",
  render: () => (
    <Demo
      title="Filters"
      width="sm"
      footer={
        <>
          <Button variant="secondary">Reset</Button>
          <Button>Apply</Button>
        </>
      }
    />
  )
};

export const Wide: Story = {
  name: "Wide (lg) for validation results",
  render: () => (
    <Demo
      title="Pre-export validation failed"
      width="lg"
      body={
        <ul>
          <li>2 invoices missing customer GSTIN</li>
          <li>1 invoice with mismatched tax totals</li>
        </ul>
      }
    />
  )
};

export const LeftSide: Story = {
  name: "Left side (nav drawer)",
  render: () => <Demo title="Navigation" side="left" width="sm" />
};

export const NonDismissible: Story = {
  name: "Backdrop click disabled",
  render: () => <Demo title="Confirm export" dismissOnBackdrop={false} />
};
