import { QueryClient } from "@tanstack/react-query";

export const QUERY_DEFAULTS = {
  staleTime: 30_000,
  retry: 1,
  refetchOnWindowFocus: false,
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_DEFAULTS.staleTime,
        retry: QUERY_DEFAULTS.retry,
        refetchOnWindowFocus: QUERY_DEFAULTS.refetchOnWindowFocus,
      },
    },
  });
}
