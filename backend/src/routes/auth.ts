import { Router } from "express";
import {
  AuthError,
  authenticate,
  clearSessionCookie,
  createFirstAdmin,
  createSession,
  destroySession,
  setSessionCookie,
  userCount,
} from "../services/auth.ts";
import { clientKey, rateLimitAllow } from "../middleware/rateLimit.ts";

export const authRouter = Router();

authRouter.get("/status", async (req, res) => {
  try {
    const setupNeeded = (await userCount()) === 0;
    res.json({
      setupNeeded,
      user: req.user ? { id: req.user.id, username: req.user.username, role: req.user.role } : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

authRouter.post("/register", async (req, res) => {
  try {
    if (!rateLimitAllow(`reg:${clientKey(req)}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Слишком много попыток, подождите" });
    }
    const { username, password } = req.body ?? {};
    const user = await createFirstAdmin(String(username ?? ""), String(password ?? ""));
    const sid = await createSession(user.id, req);
    setSessionCookie(res, sid);
    res.json({ user });
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

authRouter.post("/login", async (req, res) => {
  try {
    if (!rateLimitAllow(`login:${clientKey(req)}`, 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: "Слишком много попыток входа, подождите" });
    }
    const { username, password } = req.body ?? {};
    const user = await authenticate(String(username ?? ""), String(password ?? ""));
    const sid = await createSession(user.id, req);
    setSessionCookie(res, sid);
    res.json({ user });
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 500;
    res.status(status).json({ error: e.message });
  }
});

authRouter.post("/logout", async (req, res) => {
  try {
    await destroySession(req);
    clearSessionCookie(res);
    res.json({ success: true });
  } catch (e: any) {
    clearSessionCookie(res);
    res.status(500).json({ error: e.message });
  }
});
