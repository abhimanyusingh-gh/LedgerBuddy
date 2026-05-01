import { useEffect, useState } from "react";

interface VendorSearchBoxProps {
  value: string;
  onChange: (next: string) => void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;

export function VendorSearchBox({ value, onChange, debounceMs = DEFAULT_DEBOUNCE_MS }: VendorSearchBoxProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const handle = window.setTimeout(() => onChange(draft), debounceMs);
    return () => window.clearTimeout(handle);
  }, [draft, debounceMs, onChange, value]);

  return (
    <label className="vendors-search">
      <span className="vendors-search-label">Search</span>
      <input
        type="search"
        className="vendors-search-input"
        placeholder="Search by name, GSTIN, PAN..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        data-testid="vendors-search-input"
        aria-label="Search vendors by name, GSTIN, or PAN"
      />
    </label>
  );
}
