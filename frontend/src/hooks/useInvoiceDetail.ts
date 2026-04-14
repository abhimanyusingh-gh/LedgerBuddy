import { useCallback, useEffect, useState } from "react";
import { fetchInvoiceById } from "@/api";
import type { Invoice } from "@/types";

interface UseInvoiceDetailResult {
  detail: Invoice | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useInvoiceDetail(invoiceId: string | null): UseInvoiceDetailResult {
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!invoiceId) {
      setDetail(null);
      return;
    }

    setLoading(true);
    try {
      const invoice = await fetchInvoiceById(invoiceId);
      setDetail(invoice);
    } catch {
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    let cancelled = false;
    if (!invoiceId) {
      setDetail(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchInvoiceById(invoiceId)
      .then((invoice) => {
        if (!cancelled) {
          setDetail(invoice);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  return { detail, loading, refresh };
}
