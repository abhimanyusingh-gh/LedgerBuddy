interface TenantWorkspaceHeroProps {
  tenantName: string;
  totalInvoices: number;
  failedInvoices: number;
}

export function TenantWorkspaceHero({ tenantName, totalInvoices, failedInvoices }: TenantWorkspaceHeroProps) {
  return (
    <section className="tenant-hero">
      <div className="tenant-hero-copy">
        <h1>Invoice Workspace</h1>
        <div className="tenant-hero-subtitle">
          <span className="material-symbols-outlined">corporate_fare</span>
          <p>{tenantName} Tenant</p>
        </div>
      </div>
      <div className="tenant-hero-stats">
        <article className="tenant-stat-card">
          <span>Total Invoices</span>
          <strong>{totalInvoices}</strong>
        </article>
        <article className="tenant-stat-card">
          <span>Failed</span>
          <strong className={failedInvoices > 0 ? "tenant-stat-alert" : "tenant-stat-ok"}>{failedInvoices}</strong>
        </article>
      </div>
    </section>
  );
}
