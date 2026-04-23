/**
 * Spinner stories — CSF3-compatible fixtures. See `Button.stories.tsx` for
 * rationale on the absence of Storybook binary at this time.
 */
import type { SpinnerProps } from "./Spinner";
import { Spinner } from "./Spinner";

type Story = { name: string; args: SpinnerProps };

const meta = {
  title: "ds/Spinner",
  component: Spinner
} as const;
export default meta;

export const Default: Story = {
  name: "Default (md)",
  args: {}
};

export const Small: Story = {
  name: "Small (inline with text)",
  args: { size: "sm", label: "Loading invoices" }
};

export const Large: Story = {
  name: "Large (page-level fetch)",
  args: { size: "lg", label: "Loading payment history" }
};
