import { PlatformSection } from "./PlatformSection";

interface PlatformOnboardForm {
  tenantName: string;
  adminEmail: string;
  adminDisplayName: string;
  mode: string;
}

interface PlatformOnboardSectionProps {
  form: PlatformOnboardForm;
  collapsed: boolean;
  onToggle: () => void;
  onChange: (form: PlatformOnboardForm) => void;
  onSubmit: () => void;
  helpText?: string;
}

export function PlatformOnboardSection({
  form,
  collapsed,
  onToggle,
  onChange,
  onSubmit,
  helpText
}: PlatformOnboardSectionProps) {
  return (
    <PlatformSection
      title="Onboard Tenant Admin"
      icon="person_add"
      collapsed={collapsed}
      onToggle={onToggle}
      helpText={helpText}
      actions={
        <button type="button" className="app-button app-button-primary" onClick={onSubmit}>
          <span className="material-symbols-outlined">add_task</span>
          Create Tenant Admin
        </button>
      }
    >
      <div className="platform-form-grid">
        <label>
          <span>Tenant Name</span>
          <input
            value={form.tenantName}
            onChange={(event) => onChange({ ...form, tenantName: event.target.value })}
            placeholder="e.g. Acme Corp"
          />
        </label>
        <label>
          <span>Tenant Admin Email</span>
          <input
            value={form.adminEmail}
            onChange={(event) => onChange({ ...form, adminEmail: event.target.value })}
            placeholder="admin@tenant.com"
          />
        </label>
        <label>
          <span>Admin Name (optional)</span>
          <input
            value={form.adminDisplayName}
            onChange={(event) => onChange({ ...form, adminDisplayName: event.target.value })}
            placeholder="Full Name"
          />
        </label>
        <label>
          <span>Tenant Mode</span>
          <select
            value={form.mode ?? "test"}
            onChange={(event) => onChange({ ...form, mode: event.target.value })}
          >
            <option value="test">Test</option>
            <option value="live">Live</option>
          </select>
        </label>
      </div>
    </PlatformSection>
  );
}
