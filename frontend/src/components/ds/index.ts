/**
 * LedgerBuddy design-system — public surface.
 *
 * Import only from `@/components/ds` (this file), not from individual files,
 * so we can reshape internals without touching call-sites.
 *
 * **Scope (FE-0a scaffold)**: only primitives needed by Phase 1 PRs
 * (FE-1 .. FE-5b) ship here. Strict YAGNI — do not add primitives that no
 * near-term PR consumes. See the PR description's "Phase 1 consumption
 * matrix" for justification of every export below.
 *
 * **Planned additions** (future PRs, NOT shipped in FE-0a):
 *   - `SlideOverPanel` + `Portal` — FE-4
 *   - `Input`, `FormField` — FE-12 (payment record form)
 *   - `DataTable` — FE-11a/FE-14 (vendor list, payment voucher panel)
 *
 * **Stories convention**: each component has a co-located
 * `*.stories.tsx` file exporting an array of visual variants. Storybook
 * binary is not yet installed (the full install would exceed FE-0a's 10-file
 * budget). A follow-up PR will wire `@storybook/react-vite` and point its
 * `main.ts` at `src/** /*.stories.tsx`. In the interim, stories double as
 * exhaustive visual-regression fixtures and are renderable from the Vite
 * sandbox (see `*.stories.tsx` docblocks).
 */

export { Button } from "./Button";
export type { ButtonProps, ButtonVariant, ButtonSize } from "./Button";

export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone, BadgeSize } from "./Badge";

export { Spinner } from "./Spinner";
export type { SpinnerProps } from "./Spinner";

export { tokens, cssVar, TOKEN_CSS_VAR } from "./tokens";
export type { TokenPath, Tokens } from "./tokens";
