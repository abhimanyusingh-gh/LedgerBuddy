import { useCallback, useEffect, useState } from "react";
import {
  buildVendorDetailHash,
  parseVendorDetailHash,
  type VendorDetailHashRoute
} from "@/features/vendors/vendorDetailHashState";
import type { VendorDetailSubTab } from "@/types/vendor";

function readCurrent(): VendorDetailHashRoute | null {
  if (typeof window === "undefined") return null;
  return parseVendorDetailHash(window.location.hash);
}

export function useVendorDetailHashState(): {
  route: VendorDetailHashRoute | null;
  setSubTab: (subTab: VendorDetailSubTab) => void;
} {
  const [route, setRoute] = useState<VendorDetailHashRoute | null>(readCurrent);

  useEffect(() => {
    const handler = () => setRoute(readCurrent());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const setSubTab = useCallback(
    (subTab: VendorDetailSubTab) => {
      const current = readCurrent();
      if (!current) return;
      const next = buildVendorDetailHash({ ...current, subTab });
      if (window.location.hash !== next) {
        window.location.hash = next;
      } else {
        setRoute({ ...current, subTab });
      }
    },
    []
  );

  return { route, setSubTab };
}
