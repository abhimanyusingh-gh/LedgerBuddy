import { useEffect, useMemo, useState } from "react";
import { useUserPrefsStore } from "@/stores/userPrefsStore";

const STORAGE_PREFIX = "ledgerbuddy:url-migration-dismissed:";
const DISMISSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface UrlMigrationBannerProps {
  oldPath: string;
  newPath: string;
}

function storageKey(oldPath: string, newPath: string): string {
  return `${STORAGE_PREFIX}${oldPath}->${newPath}`;
}

export function readDismissal(key: string, now: number = Date.now()): boolean {
  const record = useUserPrefsStore.getState().urlMigration.dismissalsByKey[key];
  if (!record || record.dismissed !== true) {
    return false;
  }
  if (now - record.timestamp > DISMISSAL_TTL_MS) {
    useUserPrefsStore.getState().setUrlMigrationDismissal(key, null);
    return false;
  }
  return true;
}

export function writeDismissal(key: string, now: number = Date.now()): void {
  useUserPrefsStore.getState().setUrlMigrationDismissal(key, {
    dismissed: true,
    timestamp: now
  });
}

export function UrlMigrationBanner({ oldPath, newPath }: UrlMigrationBannerProps) {
  const key = useMemo(() => storageKey(oldPath, newPath), [oldPath, newPath]);
  const [dismissed, setDismissed] = useState(() => readDismissal(key));

  useEffect(() => {
    setDismissed(readDismissal(key));
  }, [key]);

  if (dismissed) {
    return null;
  }

  const handleDismiss = () => {
    writeDismissal(key);
    setDismissed(true);
    requestAnimationFrame(() => {
      document.getElementById("main-content")?.focus();
    });
  };

  return (
    <div className="url-migration-banner" role="status" aria-live="polite">
      <span className="material-symbols-outlined url-migration-banner-icon" aria-hidden="true">
        info
      </span>
      <p className="url-migration-banner-text">
        This page has moved to <code>{newPath}</code>. Your bookmark has been updated.
      </p>
      <button
        type="button"
        className="app-button app-button-secondary url-migration-banner-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss URL migration notice"
      >
        Dismiss
      </button>
    </div>
  );
}
