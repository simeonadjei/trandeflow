/**
 * Email Notification Service
 * ──────────────────────────
 * Sends trade result emails to the account holder.
 * Configure via environment variables:
 *   EMAIL_FROM   — sender Gmail address (e.g. you@gmail.com)
 *   EMAIL_PASS   — Gmail App Password (16-char, from Google Account → Security → App Passwords)
 *   EMAIL_TO     — override recipient (defaults to registered user email)
 *
 * If EMAIL_FROM / EMAIL_PASS are not set, notifications are silently skipped
 * (browser notifications still work as a fallback).
 */

import nodemailer from "nodemailer";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { logger } from "./logger";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const user = process.env["EMAIL_FROM"];
  const pass = process.env["EMAIL_PASS"];
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return transporter;
}

/** Look up the account owner's email from the users table. */
async function getAccountEmail(accountId: number): Promise<string | null> {
  try {
    const override = process.env["EMAIL_TO"];
    if (override) return override;
    const user = await db.query.usersTable.findFirst({
      where: (u, { eq }) => eq(u.accountId, accountId),
    });
    return user?.email ?? null;
  } catch {
    return null;
  }
}

export async function sendTradeResultEmail(opts: {
  accountId: number;
  won: boolean;
  profit: number;
  stake: number;
  asset: string;
  direction: "UP" | "DOWN";
  balance: number;
}) {
  const tp = getTransporter();
  if (!tp) return; // not configured — skip silently

  const to = await getAccountEmail(opts.accountId);
  if (!to) return;

  const from = process.env["EMAIL_FROM"];
  const emoji = opts.won ? "✅" : "❌";
  const resultWord = opts.won ? "WON" : "LOST";
  const sign = opts.won ? "+" : "-";
  const color = opts.won ? "#22c55e" : "#ef4444";

  const subject = `${emoji} Trade ${resultWord}: ${sign}GHS ${Math.abs(opts.profit).toFixed(2)} on ${opts.asset}`;

  const html = `
<div style="font-family:sans-serif;background:#0a0f1e;color:#e5e7eb;padding:24px;border-radius:12px;max-width:480px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="font-size:40px">${emoji}</span>
    <h2 style="margin:8px 0;color:${color};font-size:24px">Trade ${resultWord}</h2>
  </div>
  <div style="background:#111827;border-radius:8px;padding:16px;margin-bottom:16px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="color:#9ca3af;padding:6px 0">Asset</td><td style="text-align:right;font-weight:bold">${opts.asset}</td></tr>
      <tr><td style="color:#9ca3af;padding:6px 0">Direction</td><td style="text-align:right;font-weight:bold">${opts.direction}</td></tr>
      <tr><td style="color:#9ca3af;padding:6px 0">Stake</td><td style="text-align:right">GHS ${opts.stake.toFixed(2)}</td></tr>
      <tr><td style="color:#9ca3af;padding:6px 0">Result</td><td style="text-align:right;font-weight:bold;color:${color}">${sign}GHS ${Math.abs(opts.profit).toFixed(2)}</td></tr>
      <tr style="border-top:1px solid #374151"><td style="color:#9ca3af;padding:6px 0 0">New Balance</td><td style="text-align:right;font-weight:bold;padding-top:6px">GHS ${opts.balance.toFixed(2)}</td></tr>
    </table>
  </div>
  <p style="text-align:center;color:#6b7280;font-size:12px;margin:0">TradeFlow · Your AI-Powered Trading Bot</p>
</div>`;

  try {
    await tp.sendMail({ from, to, subject, html });
    logger.info({ to, subject }, "Trade result email sent");
  } catch (e) {
    logger.warn({ err: e, to }, "Failed to send trade result email");
  }
}
