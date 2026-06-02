import jwt from "jsonwebtoken";
import { type Request, type Response, type NextFunction } from "express";

const SECRET = process.env["SESSION_SECRET"] ?? "tradeflow-secret-key";

export interface AuthPayload {
  userId: number;
  email: string;
  role: string;
  name: string;
}

export function signToken(payload: AuthPayload) {
  return jwt.sign(payload, SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).user = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    const user = (req as any).user as AuthPayload;
    if (user.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  });
}
