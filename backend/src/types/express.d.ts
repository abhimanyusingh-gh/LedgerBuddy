import type { AuthenticatedRequestContext } from "@/types/auth.js";

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthenticatedRequestContext;
    }
  }
}

export {};
