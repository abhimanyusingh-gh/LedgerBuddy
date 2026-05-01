import {
  VENDOR_DETAIL_SUB_TAB,
  VENDOR_DETAIL_SUB_TABS,
  type VendorDetailSubTab,
  type VendorId
} from "@/types/vendor";

const VENDOR_DETAIL_HASH_PREFIX = "#/vendors/";

const SUB_TAB_PARAM = "tab";

export interface VendorDetailHashRoute {
  vendorId: VendorId;
  subTab: VendorDetailSubTab;
}

export const VENDOR_DETAIL_DEFAULT_SUB_TAB: VendorDetailSubTab = VENDOR_DETAIL_SUB_TAB.INVOICES;

export function buildVendorDetailHash(route: VendorDetailHashRoute): string {
  const base = `${VENDOR_DETAIL_HASH_PREFIX}${encodeURIComponent(route.vendorId)}`;
  if (route.subTab === VENDOR_DETAIL_DEFAULT_SUB_TAB) return base;
  const params = new URLSearchParams({ [SUB_TAB_PARAM]: route.subTab });
  return `${base}?${params.toString()}`;
}

export function parseVendorDetailHash(hash: string): VendorDetailHashRoute | null {
  if (!hash.startsWith(VENDOR_DETAIL_HASH_PREFIX)) return null;
  const rest = hash.slice(VENDOR_DETAIL_HASH_PREFIX.length);
  if (!rest) return null;
  const queryStart = rest.indexOf("?");
  const idPart = queryStart < 0 ? rest : rest.slice(0, queryStart);
  if (!idPart) return null;
  const decoded = safeDecode(idPart);
  if (!decoded) return null;
  const vendorId = decoded as VendorId;
  const search = queryStart < 0 ? "" : rest.slice(queryStart + 1);
  const params = new URLSearchParams(search);
  const tab = params.get(SUB_TAB_PARAM);
  return {
    vendorId,
    subTab: parseSubTab(tab)
  };
}

function parseSubTab(raw: string | null): VendorDetailSubTab {
  if (!raw) return VENDOR_DETAIL_DEFAULT_SUB_TAB;
  return (VENDOR_DETAIL_SUB_TABS as readonly string[]).includes(raw)
    ? (raw as VendorDetailSubTab)
    : VENDOR_DETAIL_DEFAULT_SUB_TAB;
}

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
