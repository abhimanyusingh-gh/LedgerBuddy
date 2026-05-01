import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadVendorSection197Cert } from "@/api/vendors";
import { EmptyState } from "@/components/common/EmptyState";
import { formatIstDate } from "@/features/reports/fiscalYear";
import { formatMinorAmountWithCurrency } from "@/lib/common/currency";
import type { Section197CertInput, VendorDetail, VendorId, VendorSection197Cert } from "@/types/vendor";

interface Section197CertPanelProps {
  vendorId: VendorId;
  cert: VendorSection197Cert | null;
  vendorDetailQueryKey: readonly unknown[];
}

interface CertFormState {
  certificateNumber: string;
  validFrom: string;
  validTo: string;
  maxAmountMajor: string;
  applicableRatePercent: string;
}

const EMPTY_FORM: CertFormState = {
  certificateNumber: "",
  validFrom: "",
  validTo: "",
  maxAmountMajor: "",
  applicableRatePercent: ""
};

export function Section197CertPanel({ vendorId, cert, vendorDetailQueryKey }: Section197CertPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CertFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation<VendorDetail, Error, Section197CertInput>({
    mutationFn: (payload) => uploadVendorSection197Cert(vendorId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: vendorDetailQueryKey });
      setForm(EMPTY_FORM);
      setError(null);
    },
    onError: (err) => setError(err.message)
  });

  function patchForm(partial: Partial<CertFormState>) {
    setForm((prev) => ({ ...prev, ...partial }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const validation = validateCertForm(form);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    mutation.mutate(validation.value);
  }

  return (
    <section className="vendor-detail-panel" data-testid="vendor-cert197-panel">
      <header className="vendor-detail-subheader">
        <h3>Section 197 lower-deduction certificate</h3>
      </header>

      {cert ? (
        <CertCard cert={cert} />
      ) : (
        <div className="vendor-detail-panel-state" data-testid="vendor-cert197-empty">
          <EmptyState
            icon="badge"
            heading="No Section 197 certificate on file"
            description="Upload one below to apply a reduced TDS rate to this vendor."
          />
        </div>
      )}

      <form className="vendor-cert197-form" onSubmit={handleSubmit} data-testid="vendor-cert197-form">
        <h4 className="vendor-cert197-form-title">Upload new certificate</h4>
        <label className="vendor-cert197-field">
          <span>Certificate number</span>
          <input
            type="text"
            value={form.certificateNumber}
            onChange={(event) => patchForm({ certificateNumber: event.target.value })}
            data-testid="vendor-cert197-field-number"
            required
          />
        </label>
        <div className="vendor-cert197-field-row">
          <label className="vendor-cert197-field">
            <span>Valid from</span>
            <input
              type="date"
              value={form.validFrom}
              onChange={(event) => patchForm({ validFrom: event.target.value })}
              data-testid="vendor-cert197-field-valid-from"
              required
            />
          </label>
          <label className="vendor-cert197-field">
            <span>Valid to</span>
            <input
              type="date"
              value={form.validTo}
              onChange={(event) => patchForm({ validTo: event.target.value })}
              data-testid="vendor-cert197-field-valid-to"
              required
            />
          </label>
        </div>
        <div className="vendor-cert197-field-row">
          <label className="vendor-cert197-field">
            <span>Max amount (INR)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.maxAmountMajor}
              onChange={(event) => patchForm({ maxAmountMajor: event.target.value })}
              data-testid="vendor-cert197-field-max-amount"
              required
            />
          </label>
          <label className="vendor-cert197-field">
            <span>Applicable rate (%)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.applicableRatePercent}
              onChange={(event) => patchForm({ applicableRatePercent: event.target.value })}
              data-testid="vendor-cert197-field-rate"
              required
            />
          </label>
        </div>

        {error ? (
          <p className="error vendor-cert197-error" role="alert" data-testid="vendor-cert197-error">
            {error}
          </p>
        ) : null}

        <div className="vendor-cert197-actions">
          <button
            type="submit"
            className="app-button app-button-primary"
            disabled={mutation.isPending}
            data-testid="vendor-cert197-submit"
          >
            {mutation.isPending ? "Uploading…" : "Upload certificate"}
          </button>
        </div>
      </form>
    </section>
  );
}

interface CertCardProps {
  cert: VendorSection197Cert;
}

function CertCard({ cert }: CertCardProps) {
  return (
    <div className="vendor-cert197-card" data-testid="vendor-cert197-card">
      <div className="vendor-cert197-card-row">
        <span className="vendor-cert197-card-label">Certificate</span>
        <span className="vendor-cert197-card-value">{cert.certificateNumber}</span>
      </div>
      <div className="vendor-cert197-card-row">
        <span className="vendor-cert197-card-label">Valid</span>
        <span className="vendor-cert197-card-value" data-testid="vendor-cert197-card-validity">
          {formatIstDate(cert.validFrom)} → {formatIstDate(cert.validTo)}
        </span>
      </div>
      <div className="vendor-cert197-card-row">
        <span className="vendor-cert197-card-label">Max amount</span>
        <span className="vendor-cert197-card-value">
          {formatMinorAmountWithCurrency(cert.maxAmountMinor, "INR")}
        </span>
      </div>
      <div className="vendor-cert197-card-row">
        <span className="vendor-cert197-card-label">Applicable rate</span>
        <span className="vendor-cert197-card-value">
          {(cert.applicableRateBps / 100).toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

interface ValidationOk {
  ok: true;
  value: Section197CertInput;
}

interface ValidationErr {
  ok: false;
  error: string;
}

function validateCertForm(form: CertFormState): ValidationOk | ValidationErr {
  const certificateNumber = form.certificateNumber.trim();
  if (!certificateNumber) return { ok: false, error: "Certificate number is required." };
  if (!form.validFrom) return { ok: false, error: "Valid-from date is required." };
  if (!form.validTo) return { ok: false, error: "Valid-to date is required." };
  if (form.validTo < form.validFrom) return { ok: false, error: "Valid-to must be on or after valid-from." };

  const maxAmountMajor = Number(form.maxAmountMajor);
  if (!Number.isFinite(maxAmountMajor) || maxAmountMajor < 0) {
    return { ok: false, error: "Max amount must be zero or positive." };
  }
  const maxAmountMinor = Math.round(maxAmountMajor * 100);

  const ratePercent = Number(form.applicableRatePercent);
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    return { ok: false, error: "Applicable rate must be between 0 and 100." };
  }
  const applicableRateBps = Math.round(ratePercent * 100);

  return {
    ok: true,
    value: {
      certificateNumber,
      validFrom: new Date(`${form.validFrom}T00:00:00+05:30`).toISOString(),
      validTo: new Date(`${form.validTo}T23:59:59+05:30`).toISOString(),
      maxAmountMinor,
      applicableRateBps
    }
  };
}
