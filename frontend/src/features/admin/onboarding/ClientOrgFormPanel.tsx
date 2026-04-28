import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ds";
import { SlideOverPanel } from "@/components/ds/SlideOverPanel";
import { isValidGstinFormat } from "@/lib/common/gstinFormat";
import type { ClientOrganization } from "@/api/clientOrgs";
import { DRAFT_TTL_MS, useDraft } from "@/stores/draftPersistenceStore";

export const CLIENT_ORG_FORM_MODE = {
  Add: "add",
  Edit: "edit"
} as const;

export type ClientOrgFormMode = typeof CLIENT_ORG_FORM_MODE[keyof typeof CLIENT_ORG_FORM_MODE];

export interface ClientOrgFormValues {
  gstin: string;
  companyName: string;
  stateName: string;
  f12OverwriteByGuidVerified: boolean;
}

function buildClientOrgDraftKey(mode: ClientOrgFormMode, initial: ClientOrganization | null | undefined): string {
  return mode === CLIENT_ORG_FORM_MODE.Edit && initial?._id
    ? `clientOrgFormPanel/edit/${initial._id}`
    : "clientOrgFormPanel/add";
}

interface ClientOrgFormPanelProps {
  open: boolean;
  mode: ClientOrgFormMode;
  initial?: ClientOrganization | null;
  submitting?: boolean;
  errorMessage?: string | null;
  onSubmit: (values: ClientOrgFormValues) => void;
  onClose: () => void;
}

function buildInitial(initial: ClientOrganization | null | undefined): ClientOrgFormValues {
  return {
    gstin: initial?.gstin ?? "",
    companyName: initial?.companyName ?? "",
    stateName: initial?.stateName ?? "",
    f12OverwriteByGuidVerified: initial?.f12OverwriteByGuidVerified ?? false
  };
}

export function ClientOrgFormPanel({
  open,
  mode,
  initial,
  submitting = false,
  errorMessage,
  onSubmit,
  onClose
}: ClientOrgFormPanelProps) {
  const isEdit = mode === CLIENT_ORG_FORM_MODE.Edit;
  const draftKey = buildClientOrgDraftKey(mode, initial);
  const [draft, persistDraft, clearDraft] = useDraft<ClientOrgFormValues>(draftKey, {
    ttlMs: DRAFT_TTL_MS.Default
  });
  const [values, setValues] = useState<ClientOrgFormValues>(
    () => draft ?? buildInitial(initial)
  );
  const gstinHintId = useId();
  const gstinErrorId = useId();

  useEffect(() => {
    if (open) {
      setValues(draft ?? buildInitial(initial));
    }
    // intentionally exclude `draft` to avoid stomping in-flight edits with stale store reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const updateValues = (next: ClientOrgFormValues) => {
    setValues(next);
    persistDraft(next);
  };

  const trimmedGstin = values.gstin.trim().toUpperCase();
  const trimmedCompanyName = values.companyName.trim();
  const gstinValid = isValidGstinFormat(trimmedGstin);
  const showGstinError = !isEdit && trimmedGstin.length > 0 && !gstinValid;

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (trimmedCompanyName.length === 0) return false;
    if (isEdit) return true;
    return gstinValid;
  }, [submitting, trimmedCompanyName, isEdit, gstinValid]);

  const handleSubmit = () => {
    if (!canSubmit) return;
    clearDraft();
    onSubmit({
      gstin: trimmedGstin,
      companyName: trimmedCompanyName,
      stateName: values.stateName.trim(),
      f12OverwriteByGuidVerified: values.f12OverwriteByGuidVerified
    });
  };

  return (
    <SlideOverPanel
      open={open}
      title={isEdit ? "Edit Client Organization" : "Add Client Organization"}
      onClose={onClose}
      width="md"
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
            data-testid="client-org-form-submit"
          >
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </>
      }
    >
      <form
        className="client-orgs-form"
        data-testid="client-org-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <div className="client-orgs-form-field">
          <label htmlFor="client-org-gstin">GSTIN</label>
          <input
            id="client-org-gstin"
            data-testid="client-org-gstin-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            maxLength={15}
            spellCheck={false}
            disabled={isEdit}
            value={values.gstin}
            aria-describedby={`${gstinHintId} ${showGstinError ? gstinErrorId : ""}`.trim()}
            aria-invalid={showGstinError}
            onChange={(event) =>
              updateValues({ ...values, gstin: event.target.value.toUpperCase() })
            }
          />
          <span id={gstinHintId} className="client-orgs-form-field-hint">
            15 characters: 2-digit state + 10-char PAN + entity + Z + checksum.
            {isEdit ? " GSTIN is the natural key — locked after creation." : ""}
          </span>
          {showGstinError ? (
            <span id={gstinErrorId} className="client-orgs-form-field-error" role="alert">
              GSTIN must be a 15-character format such as 29ABCPK1234F1Z5.
            </span>
          ) : null}
        </div>

        <div className="client-orgs-form-field">
          <label htmlFor="client-org-company-name">Company name</label>
          <input
            id="client-org-company-name"
            data-testid="client-org-company-name-input"
            type="text"
            autoComplete="organization"
            value={values.companyName}
            onChange={(event) =>
              updateValues({ ...values, companyName: event.target.value })
            }
          />
          <span className="client-orgs-form-field-hint">
            Friendly name shown in the realm switcher. Required.
          </span>
        </div>

        <div className="client-orgs-form-field">
          <label htmlFor="client-org-state-name">State (optional)</label>
          <input
            id="client-org-state-name"
            data-testid="client-org-state-name-input"
            type="text"
            autoComplete="address-level1"
            value={values.stateName}
            onChange={(event) =>
              updateValues({ ...values, stateName: event.target.value })
            }
          />
          <span className="client-orgs-form-field-hint">
            Drives PLACEOFSUPPLY on Tally exports. Auto-populated from the GSTIN
            prefix once the BE state lookup endpoint ships.
          </span>
        </div>

        <div className="client-orgs-form-checkbox">
          <input
            id="client-org-f12-verified"
            data-testid="client-org-f12-checkbox"
            type="checkbox"
            checked={values.f12OverwriteByGuidVerified}
            onChange={(event) =>
              updateValues({
                ...values,
                f12OverwriteByGuidVerified: event.target.checked
              })
            }
          />
          <label htmlFor="client-org-f12-verified" className="client-orgs-form-checkbox-label">
            I have enabled F12 &gt; Voucher Configuration &gt; &ldquo;Overwrite by GUID&rdquo; in
            Tally for this client.
            <span className="client-orgs-form-checkbox-hint">
              Required for idempotent re-exports. Automated probe arrives in a follow-up.
            </span>
          </label>
        </div>

        {errorMessage ? (
          <div className="client-orgs-form-field-error" role="alert" data-testid="client-org-form-error">
            {errorMessage}
          </div>
        ) : null}
      </form>
    </SlideOverPanel>
  );
}
