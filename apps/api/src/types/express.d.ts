import type { ApiUser } from "../middleware/auth";

declare global {
  namespace Express {
    interface Request {
      user?: ApiUser;
    }
  }
}

export {};