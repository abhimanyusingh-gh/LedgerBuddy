/**
 * Badge stories — CSF3-compatible fixtures. See `Button.stories.tsx` for
 * rationale on the absence of Storybook binary at this time.
 */
import type { BadgeProps } from "./Badge";
import { Badge } from "./Badge";

type Story = { name: string; args: BadgeProps };

const meta = {
  title: "ds/Badge",
  component: Badge
} as const;
export default meta;

export const Neutral: Story = {
  name: "Neutral",
  args: { tone: "neutral", children: "Draft" }
};

export const Info: Story = {
  name: "Info",
  args: { tone: "info", children: "Cross-checked" }
};

export const Success: Story = {
  name: "Success",
  args: { tone: "success", children: "Valid" }
};

export const Warning: Story = {
  name: "Warning",
  args: { tone: "warning", children: "Review: 2 signals" }
};

export const Danger: Story = {
  name: "Danger",
  args: { tone: "danger", children: "90+d overdue" }
};

export const Accent: Story = {
  name: "Accent",
  args: { tone: "accent", children: "Exported" }
};

export const WithIcon: Story = {
  name: "With icon",
  args: { tone: "warning", icon: "warning", children: "MSME 38d" }
};

export const Small: Story = {
  name: "Small (table cell)",
  args: { tone: "success", size: "sm", children: "Paid" }
};

export const DotWithAriaLabel: Story = {
  name: "Dot (aria-label only)",
  args: {
    tone: "danger",
    size: "sm",
    title: "3 critical risk signals"
  }
};
