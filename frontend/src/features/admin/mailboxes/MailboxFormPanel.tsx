import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ds";
import { SlideOverPanel } from "@/components/ds/SlideOverPanel";
import type { MailboxAssignment } from "@/api/mailboxAssignments";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";
import { ClientOrgMultiPicker } from "@/features/admin/mailboxes/ClientOrgMultiPicker";

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

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const INTEGRATION_ID_INVALID_MESSAGE = "Integration ID must be a 24-character ObjectId.";

function isValidObjectId(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}

function buildInitial(initial: MailboxAssignment | null | undefined): MailboxFormValues {
  return {
    integrationId: initial?.integrationId ?? "",
    clientOrgIds: initial?.clientOrgIds ?? []
  };
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
  const [values, setValues] = useState<MailboxFormValues>(() => buildInitial(initial));

  useEffect(() => {
    if (open) {
      setValues(buildInitial(initial));
    }
  }, [open, initial]);

  const trimmedIntegrationId = values.integrationId.trim();
  const integrationIdTouched = values.integrationId.length > 0;
  const integrationIdValid = isValidObjectId(trimmedIntegrationId);
  const hasOneClientOrg = values.clientOrgIds.length >= 1;

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!hasOneClientOrg) return false;
    if (!isEdit && !integrationIdValid) return false;
    return true;
  }, [submitting, hasOneClientOrg, isEdit, integrationIdValid]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      integrationId: trimmedIntegrationId,
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
            <label htmlFor="mailbox-form-integration-id">Integration ID</label>
            <input
              id="mailbox-form-integration-id"
              data-testid="mailbox-form-integration-id-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={values.integrationId}
              aria-invalid={integrationIdTouched && !integrationIdValid ? true : undefined}
              aria-describedby="mailbox-form-integration-id-hint"
              onChange={(event) =>
                setValues((current) => ({ ...current, integrationId: event.target.value }))
              }
            />
            <span
              id="mailbox-form-integration-id-hint"
              className="mailboxes-form-field-hint"
            >
              Identifier of the connected Gmail integration this mailbox maps
              to. A future iteration will offer a picker; for now copy the id
              from the connected mailbox row in Settings (24-character hex).
            </span>
            {integrationIdTouched && !integrationIdValid ? (
              <span
                className="mailboxes-form-field-error"
                role="alert"
                data-testid="mailbox-form-integration-id-error"
              >
                {INTEGRATION_ID_INVALID_MESSAGE}
              </span>
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
            onChange={(ids) => setValues((current) => ({ ...current, clientOrgIds: ids }))}
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
