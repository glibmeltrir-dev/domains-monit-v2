import type { NextFunction, Request, Response } from "express";
import { loadUserFromRequest } from "../services/auth.ts";

export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.user = (await loadUserFromRequest(req)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Требуется вход" });
    return;
  }
  next();
}
