import { useEffect, useRef, useState } from "react";
import type { GlCode } from "@/types";

interface GlCodeDropdownProps {
  glCodes: GlCode[];
  currentCode: string | null;
  onSelect: (code: string, name: string) => void;
  onClear: () => void;
  onClose: () => void;
}

export function GlCodeDropdown({ glCodes, currentCode, onSelect, onClear, onClose }: GlCodeDropdownProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const activeGlCodes = glCodes.filter((g) => g.isActive);
  const query = search.trim().toLowerCase();
  const filtered = query
    ? activeGlCodes.filter(
        (g) => g.code.toLowerCase().includes(query) || g.name.toLowerCase().includes(query)
      )
    : activeGlCodes;

  return (
    <div ref={containerRef} className="gl-code-dropdown" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="gl-code-dropdown-search"
        type="text"
        placeholder="Search GL codes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && filtered.length === 1) {
            onSelect(filtered[0].code, filtered[0].name);
          }
        }}
      />
      <div className="gl-code-dropdown-list">
        {currentCode ? (
          <button
            type="button"
            className="gl-code-dropdown-item gl-code-dropdown-clear"
            onClick={() => onClear()}
          >
            Clear GL code
          </button>
        ) : null}
        {filtered.length === 0 ? (
          <div className="gl-code-dropdown-empty">No matching GL codes</div>
        ) : (
          filtered.map((g) => (
            <button
              key={g.code}
              type="button"
              className={`gl-code-dropdown-item${g.code === currentCode ? " gl-code-dropdown-item-selected" : ""}`}
              onClick={() => onSelect(g.code, g.name)}
            >
              <span className="gl-code-dropdown-code">{g.code}</span>
              <span className="gl-code-dropdown-name">{g.name}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
