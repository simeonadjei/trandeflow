import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import { usersTable, accountsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, verifyToken, requireAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

// Seed admin on first load
async function ensureAdmin() {
  const existing = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, "admin@tradeflow.gh"),
  });
  if (!existing) {
    const hash = await bcrypt.hash("Admin@2024", 10);
    await db.insert(usersTable).values({
      name: "Admin",
      email: "admin@tradeflow.gh",
      passwordHash: hash,
      role: "admin",
    });
  }
}
ensureAdmin().catch(() => {});

router.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    if (!name || !email || !password || password.length < 6) {
      return res.status(400).json({ error: "Name, email and password (min 6 chars) required" });
    }
    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email.toLowerCase()) });
    if (existing) return res.status(400).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    // Create account for new user
    const [account] = await db.insert(accountsTable).values({
      name,
      balance: "1000.00",
      demoBalance: "10000.00",
      currency: "GHS",
      totalProfit: "0.00",
      totalTrades: 0,
      winRate: "0.00",
    }).returning();

    const [user] = await db.insert(usersTable).values({
      name,
      email: email.toLowerCase(),
      passwordHash: hash,
      role: "user",
      accountId: account.id,
    }).returning();

    const token = signToken({ userId: user.id, email: user.email, role: user.role, name: user.name });
    res.status(201).json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email.toLowerCase()) });
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const token = signToken({ userId: user.id, email: user.email, role: user.role, name: user.name });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  const payload = (req as any).user;
  res.json({ id: payload.userId, name: payload.name, email: payload.email, role: payload.role });
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body as { email: string };
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email?.toLowerCase()) });
    // Always return 200 to prevent email enumeration
    if (!user) return res.json({ message: "If that email exists, a reset link has been sent." });

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 3600_000); // 1 hour

    await db.update(usersTable)
      .set({ resetToken: token, resetTokenExpiry: expiry })
      .where(eq(usersTable.id, user.id));

    // In a real system, send email here. For demo, return the token directly.
    res.json({ message: "Reset link sent.", resetToken: token });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/auth/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body as { token: string; newPassword: string };
    if (!token || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Token and new password (min 6 chars) required" });
    }
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.resetToken, token) });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.update(usersTable)
      .set({ passwordHash: hash, resetToken: null, resetTokenExpiry: null })
      .where(eq(usersTable.id, user.id));

    res.json({ message: "Password reset successfully." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Reset failed" });
  }
});

export default router;
