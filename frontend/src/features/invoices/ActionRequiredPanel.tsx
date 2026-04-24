import { SlideOverPanel } from "@/components/ds/SlideOverPanel";
import { Badge, BADGE_SIZE } from "@/components/ds/Badge";
import { tokens } from "@/components/ds/tokens";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import type { ActionQueueGroup, ActionQueueItem } from "@/lib/invoice/actionRequired";
import { useActionRequiredQueue } from "@/hooks/useActionRequiredQueue";

export const ACTION_PANEL_VIEW = {
  Loading: "Loading",
  Error: "Error",
  Empty: "Empty",
  Data: "Data"
} as const;

type ActionPanelView = (typeof ACTION_PANEL_VIEW)[keyof typeof ACTION_PANEL_VIEW];

interface ActionRequiredPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectInvoice?: (invoiceId: string) => void;
  panelId?: string;
}

function resolveView(args: {
  isLoading: boolean;
  isError: boolean;
  groupCount: number;
}): ActionPanelView {
  if (args.isLoading) return ACTION_PANEL_VIEW.Loading;
  if (args.isError) return ACTION_PANEL_VIEW.Error;
  if (args.groupCount === 0) return ACTION_PANEL_VIEW.Empty;
  return ACTION_PANEL_VIEW.Data;
}

function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      style={{
        height: "2.5rem",
        borderRadius: tokens.radius.sm,
        background: tokens.color.bg.main,
        border: `1px solid ${tokens.color.line}`,
        marginBottom: tokens.space.s2
      }}
    />
  );
}

function LoadingState() {
  return (
    <div data-testid="action-panel-loading" aria-busy="true" aria-live="polite">
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="action-panel-empty"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `${tokens.space.s6} ${tokens.space.s4}`,
        textAlign: "center",
        color: tokens.color.ink.soft
      }}
    >
      <span
        className="material-symbols-outlined"
        aria-hidden="true"
        style={{ fontSize: "2.25rem", color: tokens.color.status.approved, marginBottom: tokens.space.s3 }}
      >
        task_alt
      </span>
      <p style={{ margin: 0, fontWeight: tokens.font.weight.semibold, color: tokens.color.ink.base }}>
        You&rsquo;re all caught up
      </p>
      <p style={{ margin: `${tokens.space.s2} 0 0`, fontSize: tokens.font.size.sm }}>
        No invoices need your attention right now.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      data-testid="action-panel-error"
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: tokens.space.s3,
        padding: tokens.space.s4,
        border: `1px solid ${tokens.color.line}`,
        borderRadius: tokens.radius.sm,
        background: tokens.color.bg.main
      }}
    >
      <p style={{ margin: 0, fontWeight: tokens.font.weight.semibold }}>
        Couldn&rsquo;t load action items.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{
          alignSelf: "flex-start",
          border: `1px solid ${tokens.color.line}`,
          background: tokens.color.bg.panel,
          color: tokens.color.ink.base,
          borderRadius: tokens.radius.sm,
          padding: `${tokens.space.s1} ${tokens.space.s3}`,
          cursor: "pointer"
        }}
      >
        Retry
      </button>
    </div>
  );
}

function QueueItemRow({ item, onSelect }: { item: ActionQueueItem; onSelect: (id: string) => void }) {
  const amount =
    item.totalAmountMinor !== null && item.currency
      ? formatMinorAmountWithCurrency(item.totalAmountMinor, item.currency)
      : null;
  return (
    <button
      type="button"
      data-testid="action-panel-item"
      data-invoice-id={item.invoiceId}
      onClick={() => onSelect(item.invoiceId)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: tokens.space.s1,
        width: "100%",
        textAlign: "left",
        padding: `${tokens.space.s2} ${tokens.space.s3}`,
        marginBottom: tokens.space.s2,
        border: `1px solid ${tokens.color.line}`,
        borderRadius: tokens.radius.sm,
        background: tokens.color.bg.panel,
        color: tokens.color.ink.base,
        cursor: "pointer"
      }}
    >
      <span style={{ fontWeight: tokens.font.weight.semibold }}>
        {item.vendorName || "Unknown vendor"}
      </span>
      <span style={{ fontSize: tokens.font.size.sm, color: tokens.color.ink.soft }}>
        {item.invoiceNumber || "—"}
        {amount ? ` · ${amount}` : ""}
      </span>
    </button>
  );
}

function QueueGroup({
  group,
  onSelect
}: {
  group: ActionQueueGroup;
  onSelect: (invoiceId: string) => void;
}) {
  return (
    <section data-testid="action-panel-group" data-reason={group.reason} style={{ marginBottom: tokens.space.s4 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: tokens.space.s2,
          marginBottom: tokens.space.s2
        }}
      >
        <h3 style={{ margin: 0, fontSize: tokens.font.size.md, fontWeight: tokens.font.weight.semibold }}>
          {group.label}
        </h3>
        <Badge tone={group.tone} size={BADGE_SIZE.sm}>
          {group.items.length}
        </Badge>
      </header>
      {group.items.map((item) => (
        <QueueItemRow key={item.invoiceId} item={item} onSelect={onSelect} />
      ))}
    </section>
  );
}

function TruncationFooter({ scanned, total }: { scanned: number; total: number }) {
  return (
    <p className="action-panel-truncation" data-testid="action-panel-truncation">
      Showing first {scanned} of {total} action-required invoices. More will
      surface when this queue is cleared.
    </p>
  );
}

export function ActionRequiredPanel({ open, onClose, onSelectInvoice, panelId }: ActionRequiredPanelProps) {
  const { groups, isLoading, isError, refetch, scannedCount, totalAvailable } = useActionRequiredQueue();
  const view = resolveView({ isLoading, isError, groupCount: groups.length });
  const truncated = view === ACTION_PANEL_VIEW.Data && totalAvailable > scannedCount;

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Action required" width="lg" id={panelId}>
      <div data-testid="action-panel-body" data-view={view}>
        {view === ACTION_PANEL_VIEW.Loading ? <LoadingState /> : null}
        {view === ACTION_PANEL_VIEW.Error ? <ErrorState onRetry={() => void refetch()} /> : null}
        {view === ACTION_PANEL_VIEW.Empty ? <EmptyState /> : null}
        {view === ACTION_PANEL_VIEW.Data
          ? groups.map((group) => (
              <QueueGroup
                key={group.reason}
                group={group}
                onSelect={(invoiceId) => {
                  onSelectInvoice?.(invoiceId);
                  onClose();
                }}
              />
            ))
          : null}
        {truncated ? <TruncationFooter scanned={scannedCount} total={totalAvailable} /> : null}
      </div>
    </SlideOverPanel>
  );
}

