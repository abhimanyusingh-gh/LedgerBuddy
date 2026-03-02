import { PlatformSection } from "./PlatformSection";

interface PlatformStats {
  tenants: number;
  users: number;
  totalDocuments: number;
  approvedDocuments: number;
  exportedDocuments: number;
  failedDocuments: number;
}

interface PlatformStatsSectionProps {
  stats: PlatformStats;
  collapsed: boolean;
  onToggle: () => void;
}

const STAT_TILES: Array<{ key: keyof PlatformStats; label: string; icon: string; valueClassName?: string }> = [
  { key: "tenants", label: "Tenants", icon: "corporate_fare" },
  { key: "users", label: "Users", icon: "group" },
  { key: "totalDocuments", label: "Documents", icon: "description" },
  { key: "approvedDocuments", label: "Approved", icon: "verified" },
  { key: "exportedDocuments", label: "Exported", icon: "ios_share" },
  { key: "failedDocuments", label: "Failed", icon: "error_outline", valueClassName: "platform-stat-value-alert" }
];

export function PlatformStatsSection({ stats, collapsed, onToggle }: PlatformStatsSectionProps) {
  return (
    <PlatformSection title="Platform Statistics" icon="bar_chart" collapsed={collapsed} onToggle={onToggle}>
      <div className="platform-stats-grid" data-testid="platform-stats-grid">
        {STAT_TILES.map((tile) => (
          <article key={tile.key} className="platform-stat-tile">
            <span className="material-symbols-outlined platform-stat-icon">{tile.icon}</span>
            <h4>{tile.label}</h4>
            <p className={tile.valueClassName}>{stats[tile.key]}</p>
          </article>
        ))}
      </div>
    </PlatformSection>
  );
}
