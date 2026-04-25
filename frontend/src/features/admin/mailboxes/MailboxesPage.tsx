import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "@/components/ds";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useTenantClientOrgs } from "@/hooks/useTenantClientOrgs";
import {
  MAILBOX_ASSIGNMENTS_QUERY_KEY,
  useMailboxAssignments
} from "@/hooks/useMailboxAssignments";
import { getUserFacingErrorMessage } from "@/lib/common/apiError";
import {
  createMailboxAssignment,
  deleteMailboxAssignment,
  updateMailboxAssignment,
  type MailboxAssignment
} from "@/api/mailboxAssignments";
import {
  MAILBOX_FORM_MODE,
  MailboxFormPanel,
  type MailboxFormMode,
  type MailboxFormValues
} from "@/features/admin/mailboxes/MailboxFormPanel";
import { MailboxesTable } from "@/features/admin/mailboxes/MailboxesTable";

export const MAILBOXES_PAGE_VIEW = {
  Loading: "loading",
  Error: "error",
  Empty: "empty",
  Data: "data"
} as const;

type MailboxesPageView = typeof MAILBOXES_PAGE_VIEW[keyof typeof MAILBOXES_PAGE_VIEW];

interface FormState {
  open: boolean;
  mode: MailboxFormMode;
  target: MailboxAssignment | null;
  errorMessage: string | null;
}

const INITIAL_FORM_STATE: FormState = {
  open: false,
  mode: MAILBOX_FORM_MODE.Add,
  target: null,
  errorMessage: null
};

export function MailboxesPage() {
  const query = useMailboxAssignments();
  const queryClient = useQueryClient();
  const tenantClientOrgs = useTenantClientOrgs();

  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
  const [deleteTarget, setDeleteTarget] = useState<MailboxAssignment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: MAILBOX_ASSIGNMENTS_QUERY_KEY });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: createMailboxAssignment,
    onSuccess: () => {
      invalidateList();
      setFormState(INITIAL_FORM_STATE);
    },
    onError: (error: unknown) => {
      setFormState((current) => ({
        ...current,
        errorMessage: getUserFacingErrorMessage(error, "Failed to create the mailbox assignment.")
      }));
    }
  });

  const updateMutation = useMutation({
    mutationFn: (input: { id: string; values: MailboxFormValues }) =>
      updateMailboxAssignment(input.id, { clientOrgIds: input.values.clientOrgIds }),
    onSuccess: () => {
      invalidateList();
      setFormState(INITIAL_FORM_STATE);
    },
    onError: (error: unknown) => {
      setFormState((current) => ({
        ...current,
        errorMessage: getUserFacingErrorMessage(error, "Failed to update the mailbox assignment.")
      }));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteMailboxAssignment,
    onSuccess: () => {
      invalidateList();
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (error: unknown) => {
      setDeleteError(
        getUserFacingErrorMessage(error, "Failed to delete the mailbox assignment.")
      );
    }
  });

  const view: MailboxesPageView = (() => {
    if (query.status === "pending") return MAILBOXES_PAGE_VIEW.Loading;
    if (query.status === "error") return MAILBOXES_PAGE_VIEW.Error;
    if ((query.data ?? []).length === 0) return MAILBOXES_PAGE_VIEW.Empty;
    return MAILBOXES_PAGE_VIEW.Data;
  })();

  const ingestionCounts = useMemo<Record<string, number | undefined>>(() => {
    // Backend ingestion-count column is sourced from
    // `recentIngestions(days: 30)` per assignment in a follow-up wave;
    // for now we render the placeholder em-dash. Stub kept here so the
    // table contract matches the brief and follow-up can wire data in
    // without a second prop drill.
    return {};
  }, []);

  const openAddForm = useCallback(() => {
    setFormState({ open: true, mode: MAILBOX_FORM_MODE.Add, target: null, errorMessage: null });
  }, []);

  const openEditForm = useCallback((target: MailboxAssignment) => {
    setFormState({ open: true, mode: MAILBOX_FORM_MODE.Edit, target, errorMessage: null });
  }, []);

  const handleSubmit = useCallback(
    (values: MailboxFormValues) => {
      if (formState.mode === MAILBOX_FORM_MODE.Edit && formState.target) {
        updateMutation.mutate({ id: formState.target._id, values });
        return;
      }
      createMutation.mutate({
        integrationId: values.integrationId,
        clientOrgIds: values.clientOrgIds
      });
    },
    [createMutation, updateMutation, formState]
  );

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <section
      className="mailboxes-page"
      data-testid="mailboxes-page"
      data-view={view}
      aria-busy={view === MAILBOXES_PAGE_VIEW.Loading || undefined}
    >
      <header className="mailboxes-page-header">
        <div>
          <h1>Mailboxes</h1>
          <p>
            Map each connected Gmail mailbox to one or more Client Organizations.
            Polled invoices auto-route by GSTIN; ambiguous matches land in Triage.
          </p>
        </div>
        {view === MAILBOXES_PAGE_VIEW.Data ? (
          <Button onClick={openAddForm} icon="add" data-testid="mailboxes-add-button">
            Add mailbox assignment
          </Button>
        ) : null}
      </header>

      {view === MAILBOXES_PAGE_VIEW.Loading ? (
        <div
          className="mailboxes-state"
          data-testid="mailboxes-loading"
          role="status"
          aria-live="polite"
        >
          <Spinner />
          <p>Loading mailbox assignments…</p>
        </div>
      ) : null}

      {view === MAILBOXES_PAGE_VIEW.Error ? (
        <div
          className="mailboxes-state mailboxes-state-error"
          data-testid="mailboxes-error"
          role="alert"
        >
          <p>{getUserFacingErrorMessage(query.error, "Couldn't load mailbox assignments.")}</p>
          <Button onClick={() => void query.refetch()} variant="secondary">
            Retry
          </Button>
        </div>
      ) : null}

      {view === MAILBOXES_PAGE_VIEW.Empty ? (
        <div className="mailboxes-state mailboxes-state-empty" data-testid="mailboxes-empty">
          <h2>No mailboxes connected yet</h2>
          <p>
            Connect a Gmail mailbox in Settings &gt; Integrations, then map it
            to one or more Client Organizations to start polling invoices.
          </p>
          <Button onClick={openAddForm} icon="add" data-testid="mailboxes-empty-cta">
            Add mailbox assignment
          </Button>
        </div>
      ) : null}

      {view === MAILBOXES_PAGE_VIEW.Data ? (
        <MailboxesTable
          items={query.data ?? []}
          clientOrgs={tenantClientOrgs.clientOrgs}
          ingestionCounts={ingestionCounts}
          onEdit={openEditForm}
          onDelete={(target) => {
            setDeleteError(null);
            setDeleteTarget(target);
          }}
        />
      ) : null}

      <MailboxFormPanel
        open={formState.open}
        mode={formState.mode}
        initial={formState.target}
        clientOrgs={tenantClientOrgs.clientOrgs}
        clientOrgsLoading={tenantClientOrgs.isLoading}
        clientOrgsError={tenantClientOrgs.isError}
        onClientOrgsRetry={() => void tenantClientOrgs.refetch()}
        submitting={submitting}
        errorMessage={formState.errorMessage}
        onSubmit={handleSubmit}
        onClose={() => setFormState(INITIAL_FORM_STATE)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete mailbox assignment?"
        message={
          deleteError ??
          `Removing the mapping for "${deleteTarget?.email ?? "(unknown mailbox)"}" stops new invoices from auto-routing to its current client organizations. Existing invoices stay assigned.`
        }
        confirmLabel={deleteMutation.isPending ? "Deleting…" : "Delete"}
        destructive
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget._id);
          }
        }}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </section>
  );
}
