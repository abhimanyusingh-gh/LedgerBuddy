interface PlatformOverviewHeroProps {
  tenantCount: number;
  failedDocuments: number;
}

export function PlatformOverviewHero({ tenantCount, failedDocuments }: PlatformOverviewHeroProps) {
  return (
    <section className="platform-hero">
      <div className="platform-hero-copy">
        <h2>Platform Overview</h2>
        <p>Manage global tenants and monitor real-time document processing metrics.</p>
      </div>
      <div className="platform-hero-metrics">
        <div className="platform-hero-metric">
          <span>Tenants</span>
          <strong>{tenantCount}</strong>
        </div>
        <div className="platform-hero-metric platform-hero-metric-alert">
          <span>Failed Docs</span>
          <strong>{failedDocuments}</strong>
        </div>
      </div>
    </section>
  );
}
