import { useCallback, useEffect, useState } from "react";
import {
  buildVendorListHash,
  parseVendorListHash,
  VENDOR_LIST_DEFAULT_STATE,
  type VendorListHashState
} from "@/features/vendors/vendorListHashState";

function readCurrentHashState(): VendorListHashState {
  if (typeof window === "undefined") return VENDOR_LIST_DEFAULT_STATE;
  return parseVendorListHash(window.location.hash);
}

export function useVendorListHashState(): {
  state: VendorListHashState;
  setState: (next: VendorListHashState) => void;
  patch: (partial: Partial<VendorListHashState>) => void;
  reset: () => void;
} {
  const [state, setLocalState] = useState<VendorListHashState>(readCurrentHashState);

  useEffect(() => {
    const handler = () => setLocalState(readCurrentHashState());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  const setState = useCallback((next: VendorListHashState) => {
    const nextHash = buildVendorListHash(next);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      setLocalState(next);
    }
  }, []);

  const patch = useCallback(
    (partial: Partial<VendorListHashState>) => {
      const merged: VendorListHashState = { ...readCurrentHashState(), ...partial };
      const nextHash = buildVendorListHash(merged);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      } else {
        setLocalState(merged);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState(VENDOR_LIST_DEFAULT_STATE);
  }, [setState]);

  return { state, setState, patch, reset };
}
