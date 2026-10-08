import fs from "node:fs";
import path from "node:path";

// Audit log minimale: JSONL append-only con rotazione.
// - In locale scrive su ./logs/audit.log (configurabile con AUDIT_LOG_PATH).
// - Su Vercel il filesystem è effimero: gli eventi vanno comunque in console
//   (catturati dai log drains) e, se configurato, a un webhook (AUDIT_WEBHOOK_URL).
// Tutte le scritture sono best-effort: mai far fallire una richiesta per l'audit.

export type AuditEventType =
  | "auth.login_ok"
  | "auth.login_ko"
  | "auth.mfa_challenge"
  | "auth.alert_bruteforce"
  | "user.created"
  | "user.updated"
  | "user.deleted"
  | "user.mfa_enabled"
  | "user.mfa_disabled"
  | "user.mfa_reset"
  | "settings.updated"
  | "invoice.created"
  | "invoice.exported"
  | "invoice.deleted";

export interface AuditEvent {
  ts: string;
  type: AuditEventType;
  actor?: string;
  target?: string;
  ip?: string;
  details?: Record<string, unknown>;
}

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_ROTATED = 5;

function logPath(): string | null {
  if (process.env.AUDIT_LOG_PATH) return process.env.AUDIT_LOG_PATH;
  if (process.env.VERCEL) return "/tmp/solo-audit.log";
  return path.join(process.cwd(), "logs", "audit.log");
}

function rotateIfNeeded(file: string): void {
  try {
    const stat = fs.statSync(file);
    if (stat.size < MAX_BYTES) return;
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      const from = `${file}.${i}`;
      const to = `${file}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(file, `${file}.1`);
  } catch {
    // Il file potrebbe non esistere ancora: niente da ruotare.
  }
}

export function auditEvent(event: Omit<AuditEvent, "ts">): void {
  const entry: AuditEvent = { ...event, ts: new Date().toISOString() };
  const line = JSON.stringify(entry);
  // Sempre in console: finisce nei log Docker/Vercel.
  console.log(`[audit] ${line}`);
  const file = logPath();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateIfNeeded(file);
    fs.appendFileSync(file, line + "\n", { encoding: "utf8" });
  } catch {
    // Best-effort: l'audit non deve mai rompere il flusso applicativo.
  }
}

export function auditWebhookAlert(event: Omit<AuditEvent, "ts">): void {
  const url = process.env.AUDIT_WEBHOOK_URL;
  if (!url) return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, ts: new Date().toISOString() }),
    }).catch(() => undefined);
  } catch {
    // Best-effort.
  }
}

// Traccia i fallimenti di login per IP (sliding window): al superamento della
// soglia restituisce "alert" una sola volta per finestra (anti brute-force, A09).
const failureWindows = new Map<string, { count: number; resetAt: number; alerted: boolean }>();
const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;

export function noteAuthFailure(ip: string): "ok" | "alert" {
  const now = Date.now();
  const entry = failureWindows.get(ip);
  if (!entry || now >= entry.resetAt) {
    failureWindows.set(ip, { count: 1, resetAt: now + FAILURE_WINDOW_MS, alerted: false });
    return "ok";
  }
  entry.count += 1;
  if (entry.count >= FAILURE_THRESHOLD && !entry.alerted) {
    entry.alerted = true;
    return "alert";
  }
  return "ok";
}

// Solo per i test: legge eventi da un file custom senza toccare quello reale.
export function __readAuditLogForTests(file: string): AuditEvent[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}
