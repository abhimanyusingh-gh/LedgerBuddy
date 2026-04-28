import { useEffect, useMemo, useState } from "react";
import { Button, Spinner } from "@/components/ds";
import { SlideOverPanel } from "@/components/ds/SlideOverPanel";
import type { AvailableIntegration, MailboxAssignment } from "@/api/mailboxAssignments";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";
import { ClientOrgMultiPicker } from "@/features/admin/mailboxes/ClientOrgMultiPicker";
import { useAvailableIntegrations } from "@/hooks/useAvailableIntegrations";
import { DRAFT_TTL_MS, useDraft } from "@/stores/draftPersistenceStore";

export const MAILBOX_FORM_MODE = {
  Add: "add",
  Edit: "edit"
} as const;

export type MailboxFormMode = typeof MAILBOX_FORM_MODE[keyof typeof MAILBOX_FORM_MODE];

export interface MailboxFormValues {
  integrationId: string;
  clientOrgIds: string[];
}

interface MailboxFormPanelProps {
  open: boolean;
  mode: MailboxFormMode;
  initial?: MailboxAssignment | null;
  clientOrgs: ClientOrgOption[] | undefined;
  clientOrgsLoading: boolean;
  clientOrgsError: boolean;
  onClientOrgsRetry: () => void;
  submitting?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: MailboxFormValues) => void;
  onClose: () => void;
}

const INTEGRATIONS_EMPTY_MESSAGE =
  "No available integrations to assign — contact admin to add one.";
const INTEGRATIONS_ERROR_MESSAGE = "Couldn't load integrations.";

function describeIntegration(integration: AvailableIntegration): string {
  const email = integration.emailAddress ?? "(no email)";
  const provider = integration.provider ?? "unknown";
  const status = integration.status ?? "unknown";
  return `${email} (${provider}, ${status})`;
}

function buildInitial(initial: MailboxAssignment | null | undefined): MailboxFormValues {
  return {
    integrationId: initial?.integrationId ?? "",
    clientOrgIds: initial?.clientOrgIds ?? []
  };
}

function buildMailboxDraftKey(
  mode: MailboxFormMode,
  initial: MailboxAssignment | null | undefined
): string {
  return mode === MAILBOX_FORM_MODE.Edit && initial?._id
    ? `mailboxFormPanel/edit/${initial._id}`
    : "mailboxFormPanel/add";
}

function buildRoutingPreview(
  selectedIds: string[],
  clientOrgs: ClientOrgOption[] | undefined
): string {
  if (selectedIds.length === 0) {
    return "Select at least one client organization to enable polling.";
  }
  const resolved = selectedIds
    .map((id) => clientOrgs?.find((org) => org.id === id))
    .filter((org): org is ClientOrgOption => Boolean(org));
  if (resolved.length === 0) {
    return "No valid client organizations selected — please re-select.";
  }
  if (resolved.length === 1) {
    return `All polled invoices auto-assign to ${resolved[0].companyName}.`;
  }
  return "Polled invoices match by customer GSTIN. Unmatched invoices land in Triage for manual assignment.";
}

export function MailboxFormPanel({
  open,
  mode,
  initial,
  clientOrgs,
  clientOrgsLoading,
  clientOrgsError,
  onClientOrgsRetry,
  submitting = false,
  errorMessage,
  onSubmit,
  onClose
}: MailboxFormPanelProps) {
  const isEdit = mode === MAILBOX_FORM_MODE.Edit;
  const draftKey = buildMailboxDraftKey(mode, initial);
  const [draft, persistDraft, clearDraft] = useDraft<MailboxFormValues>(draftKey, {
    ttlMs: DRAFT_TTL_MS.Default
  });
  const [values, setValues] = useState<MailboxFormValues>(
    () => draft ?? buildInitial(initial)
  );

  useEffect(() => {
    if (open) {
      setValues(draft ?? buildInitial(initial));
    }
    // intentionally exclude `draft` to avoid stomping in-flight edits with stale store reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const updateValues = (next: MailboxFormValues) => {
    setValues(next);
    persistDraft(next);
  };

  const integrationsQuery = useAvailableIntegrations(open && !isEdit);

  const hasIntegrationId = values.integrationId.length > 0;
  const hasOneClientOrg = values.clientOrgIds.length >= 1;

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!hasOneClientOrg) return false;
    if (!isEdit && !hasIntegrationId) return false;
    return true;
  }, [submitting, hasOneClientOrg, isEdit, hasIntegrationId]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    clearDraft();
    onSubmit({
      integrationId: values.integrationId,
      clientOrgIds: values.clientOrgIds
    });
  };

  const routingPreview = buildRoutingPreview(values.clientOrgIds, clientOrgs);

  return (
    <SlideOverPanel
      open={open}
      title={isEdit ? "Edit mailbox assignment" : "Add mailbox assignment"}
      onClose={onClose}
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            loading={submitting}
            data-testid="mailbox-form-submit"
          >
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </>
      }
    >
      <form
        className="mailboxes-form"
        data-testid="mailbox-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className="mailboxes-form-field">
          <label htmlFor="mailbox-form-email">Mailbox</label>
          <input
            id="mailbox-form-email"
            data-testid="mailbox-form-email-input"
            type="email"
            autoComplete="off"
            disabled
            value={initial?.email ?? ""}
            placeholder={isEdit ? "" : "Connect Gmail in Settings to populate."}
          />
          <span className="mailboxes-form-field-hint">
            {isEdit
              ? "Email is the natural key for this mapping — locked after creation."
              : "Connect a Gmail mailbox via Settings > Integrations first."}
          </span>
        </div>

        {!isEdit ? (
          <div className="mailboxes-form-field">
            <label htmlFor="mailbox-form-integration-id">Integration</label>
            {integrationsQuery.status === "pending" ? (
              <div
                className="mailboxes-form-field-loading"
                data-testid="mailbox-form-integration-loading"
                role="status"
                aria-live="polite"
              >
                <Spinner />
                <span>Loading available integrations…</span>
              </div>
            ) : null}
            {integrationsQuery.status === "success" && integrationsQuery.data.length === 0 ? (
              <span
                className="mailboxes-form-field-hint"
                data-testid="mailbox-form-integration-empty"
              >
                {INTEGRATIONS_EMPTY_MESSAGE}
              </span>
            ) : null}
            {integrationsQuery.status === "success" && integrationsQuery.data.length > 0 ? (
              <select
                id="mailbox-form-integration-id"
                data-testid="mailbox-form-integration-id-select"
                value={values.integrationId}
                onChange={(event) =>
                  updateValues({ ...values, integrationId: event.target.value })
                }
              >
                <option value="">Select a connected integration…</option>
                {integrationsQuery.data.map((integration) => (
                  <option key={integration._id} value={integration._id}>
                    {describeIntegration(integration)}
                  </option>
                ))}
              </select>
            ) : null}
            {integrationsQuery.status === "error" ? (
              <div
                className="mailboxes-form-field-error"
                role="alert"
                data-testid="mailbox-form-integration-error"
              >
                <span>{INTEGRATIONS_ERROR_MESSAGE}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void integrationsQuery.refetch();
                  }}
                  data-testid="mailbox-form-integration-retry"
                >
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mailboxes-form-field">
          <label>Client organizations</label>
          <span className="mailboxes-form-field-hint">
            Pick every client whose invoices may arrive at this mailbox.
            Validation requires at least one.
          </span>
          {/* composite-key write contract: array contents validated tenant-side, see #174 */}
          <ClientOrgMultiPicker
            clientOrgs={clientOrgs}
            isLoading={clientOrgsLoading}
            isError={clientOrgsError}
            onRetry={onClientOrgsRetry}
            selectedIds={values.clientOrgIds}
            onChange={(ids) => updateValues({ ...values, clientOrgIds: ids })}
          />
        </div>

        <div
          className="mailboxes-form-routing-preview"
          data-testid="mailbox-form-routing-preview"
          role="note"
        >
          <strong>How will invoices route?</strong>
          <p>{routingPreview}</p>
        </div>

        {errorMessage ? (
          <div
            className="mailboxes-form-field-error"
            role="alert"
            data-testid="mailbox-form-error"
          >
            {errorMessage}
          </div>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}
