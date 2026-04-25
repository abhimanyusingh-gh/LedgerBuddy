import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ds";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useActiveClientOrg } from "@/hooks/useActiveClientOrg";
import {
  TENANT_CLIENT_ORGS_QUERY_KEY,
  useClientOrgsAdminList
} from "@/hooks/useTenantClientOrgs";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";
import {
  ARCHIVE_RESULT_STATUS,
  createClientOrganization,
  deleteClientOrganization,
  updateClientOrganization,
  type ArchiveClientOrganizationResult,
  type ClientOrganization
} from "@/api/clientOrgs";
import {
  CLIENT_ORG_FORM_MODE,
  ClientOrgFormPanel,
  type ClientOrgFormMode,
  type ClientOrgFormValues
} from "@/features/admin/onboarding/ClientOrgFormPanel";
import { ClientOrgsTable } from "@/features/admin/onboarding/ClientOrgsTable";
import { summarizeLinkedCounts } from "@/features/admin/onboarding/clientOrgArchiveSummary";

export const CLIENT_ORGS_PAGE_VIEW = {
  Loading: "loading",
  Error: "error",
  Empty: "empty",
  Data: "data"
} as const;

type ClientOrgsPageView = typeof CLIENT_ORGS_PAGE_VIEW[keyof typeof CLIENT_ORGS_PAGE_VIEW];

interface FormState {
  open: boolean;
  mode: ClientOrgFormMode;
  target: ClientOrganization | null;
  errorMessage: string | null;
}

const INITIAL_FORM_STATE: FormState = {
  open: false,
  mode: CLIENT_ORG_FORM_MODE.Add,
  target: null,
  errorMessage: null
};

interface ArchiveSuccessNotice {
  companyName: string;
  result: ArchiveClientOrganizationResult;
}

export function ClientOrgsPage() {
  const query = useClientOrgsAdminList();
  const queryClient = useQueryClient();
  const { activeClientOrgId, setActiveClientOrg } = useActiveClientOrg();

  const [searchTerm, setSearchTerm] = useState("");
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
  const [archiveTarget, setArchiveTarget] = useState<ClientOrganization | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<ArchiveSuccessNotice | null>(null);

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: TENANT_CLIENT_ORGS_QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: createClientOrganization,
    onSuccess: (created) => {
      invalidateList();
      setActiveClientOrg(created._id);
      setFormState(INITIAL_FORM_STATE);
    },
    onError: (error: unknown) => {
      setFormState((current) => ({
        ...current,
        errorMessage: getUserFacingErrorMessage(error, "Failed to create the client organization.")
      }));
    }
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; values: ClientOrgFormValues }) =>
      updateClientOrganization(input.id, {
        companyName: input.values.companyName,
        stateName: input.values.stateName.length > 0 ? input.values.stateName : undefined,
        f12OverwriteByGuidVerified: input.values.f12OverwriteByGuidVerified
      }),
    onSuccess: () => {
      invalidateList();
      setFormState(INITIAL_FORM_STATE);
    },
    onError: (error: unknown) => {
      setFormState((current) => ({
        ...current,
        errorMessage: getUserFacingErrorMessage(error, "Failed to update the client organization.")
      }));
    }
  });

  const archiveMutation = useMutation({
    mutationFn: deleteClientOrganization,
    onSuccess: (result, archivedId) => {
      invalidateList();
      if (activeClientOrgId === archivedId) {
        setActiveClientOrg(null);
      }
      const archivedCompanyName = archiveTarget?.companyName ?? "";
      setArchiveTarget(null);
      setArchiveError(null);
      setArchiveNotice({ companyName: archivedCompanyName, result });
    },
    onError: (error: unknown) => {
      setArchiveError(
        getUserFacingErrorMessage(
          error,
          "Couldn't archive — accounting records are still linked to this client."
        )
      );
    }
  });

  const view: ClientOrgsPageView = (() => {
    if (query.status === "pending") return CLIENT_ORGS_PAGE_VIEW.Loading;
    if (query.status === "error") return CLIENT_ORGS_PAGE_VIEW.Error;
    if (query.data.length === 0) return CLIENT_ORGS_PAGE_VIEW.Empty;
    return CLIENT_ORGS_PAGE_VIEW.Data;
  })();

  const openAddForm = useCallback(() => {
    setFormState({ open: true, mode: CLIENT_ORG_FORM_MODE.Add, target: null, errorMessage: null });
  }, []);

  const openEditForm = useCallback((target: ClientOrganization) => {
    setFormState({ open: true, mode: CLIENT_ORG_FORM_MODE.Edit, target, errorMessage: null });
  }, []);

  const handleSubmit = useCallback(
    (values: ClientOrgFormValues) => {
      if (formState.mode === CLIENT_ORG_FORM_MODE.Edit && formState.target) {
        updateMutation.mutate({ id: formState.target._id, values });
        return;
      }
      createMutation.mutate({
        gstin: values.gstin,
        companyName: values.companyName,
        stateName: values.stateName.length > 0 ? values.stateName : undefined
      });
    },
    [createMutation, updateMutation, formState]
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <section
      className="client-orgs-page"
      data-testid="client-orgs-page"
      data-view={view}
      aria-busy={view === CLIENT_ORGS_PAGE_VIEW.Loading || undefined}
    >
      <header className="client-orgs-page-header">
        <div>
          <h1>Client Organizations</h1>
          <p>
            Each client your firm services lives here. Onboarding gates every
            accounting surface until at least one is created.
          </p>
        </div>
        {view === CLIENT_ORGS_PAGE_VIEW.Data ? (
          <Button onClick={openAddForm} icon="add" data-testid="client-orgs-add-button">
            Add Client Organization
          </Button>
        ) : null}
      </header>

      {view === CLIENT_ORGS_PAGE_VIEW.Loading ? (
        <div
          className="client-orgs-state"
          data-testid="client-orgs-loading"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <p>Loading your client organizations…</p>
        </div>
      ) : null}

      {view === CLIENT_ORGS_PAGE_VIEW.Error ? (
        <div
          className="client-orgs-state client-orgs-state-error"
          data-testid="client-orgs-error"
          role="alert"
        >
          <p>{getUserFacingErrorMessage(query.error, "Couldn't load client organizations.")}</p>
          <Button onClick={() => void query.refetch()} variant="secondary">
            Retry
          </Button>
        </div>
      ) : null}

      {view === CLIENT_ORGS_PAGE_VIEW.Empty ? (
        <div className="client-orgs-state client-orgs-state-empty" data-testid="client-orgs-empty">
          <h2>Add your first Client Organization</h2>
          <p>
            Capture the GSTIN, friendly name, and (optionally) the state for the
            client. We&apos;ll auto-select it as your active realm so accounting
            screens unlock immediately.
          </p>
          <Button onClick={openAddForm} icon="add" data-testid="client-orgs-empty-cta">
            Add Client Organization
          </Button>
        </div>
      ) : null}

      {archiveNotice ? (
        <ArchiveNoticeBanner
          notice={archiveNotice}
          onDismiss={() => setArchiveNotice(null)}
        />
      ) : null}

      {view === CLIENT_ORGS_PAGE_VIEW.Data ? (
        <>
          <div className="client-orgs-toolbar">
            <input
              className="client-orgs-search"
              type="search"
              value={searchTerm}
              placeholder="Search by name or GSTIN"
              aria-label="Search client organizations"
              onChange={(event) => setSearchTerm(event.target.value)}
              data-testid="client-orgs-search"
            />
          </div>
          <ClientOrgsTable
            items={query.data ?? []}
            searchTerm={searchTerm}
            activeClientOrgId={activeClientOrgId}
            onEdit={openEditForm}
            onArchive={(target) => {
              setArchiveError(null);
              setArchiveTarget(target);
            }}
            onSelect={(target) => setActiveClientOrg(target._id)}
          />
        </>
      ) : null}

      <ClientOrgFormPanel
        open={formState.open}
        mode={formState.mode}
        initial={formState.target}
        submitting={submitting}
        errorMessage={formState.errorMessage}
        onSubmit={handleSubmit}
        onClose={() => setFormState(INITIAL_FORM_STATE)}
      />

      <ConfirmDialog
        open={archiveTarget !== null}
        title="Archive client organization?"
        message={
          archiveError ??
          `Archiving "${archiveTarget?.companyName ?? ""}" hides it from the realm switcher. All linked accounting records (invoices, vendors, bank statements, etc.) remain read-accessible. An exact per-record-type breakdown is shown after confirmation.`
        }
        confirmLabel={archiveMutation.isPending ? "Archiving…" : "Archive"}
        destructive
        onConfirm={() => {
          if (archiveTarget) {
            archiveMutation.mutate(archiveTarget._id);
          }
        }}
        onCancel={() => {
          setArchiveTarget(null);
          setArchiveError(null);
        }}
      />
    </section>
  );
}

interface ArchiveNoticeBannerProps {
  notice: ArchiveSuccessNotice;
  onDismiss: () => void;
}

function ArchiveNoticeBanner({ notice, onDismiss }: ArchiveNoticeBannerProps) {
  const breakdown = summarizeLinkedCounts(notice.result.linkedCounts);
  const wasDeleted = notice.result.status === ARCHIVE_RESULT_STATUS.Deleted;

  const summaryText = (() => {
    if (wasDeleted) {
      return `Removed "${notice.companyName}" — no linked accounting records existed, so the org was deleted outright.`;
    }
    if (breakdown.length === 0) {
      return `Archived "${notice.companyName}". No linked accounting records were detected.`;
    }
    const items = breakdown.map((entry) => entry.text).join(", ");
    return `Archived "${notice.companyName}". ${items} remain read-only and accessible from history.`;
  })();

  return (
    <div
      className="client-orgs-archive-notice"
      role="status"
      aria-live="polite"
      data-testid="client-orgs-archive-notice"
      data-status={notice.result.status}
    >
      <div className="client-orgs-archive-notice-body">
        <strong>{wasDeleted ? "Deleted" : "Archived"}.</strong>
        <p>{summaryText}</p>
        {breakdown.length > 0 && !wasDeleted ? (
          <ul className="client-orgs-archive-notice-list" data-testid="client-orgs-archive-notice-list">
            {breakdown.map((entry) => (
              <li key={entry.label} data-testid={`client-orgs-archive-notice-item-${entry.label}`}>
                {entry.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        data-testid="client-orgs-archive-notice-dismiss"
      >
        Dismiss
      </Button>
    </div>
  );
}
