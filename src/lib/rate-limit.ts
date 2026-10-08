// Rate limiting in-memory (sliding window) per istanza.
// Adatto a deploy single-instance (locale/Vercel single region senza burst distribuito:
// su multi-istanza il limite vale per istanza — documentato in docs/SECURITY.md).

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

// Quota invio email per destinatario: 1/minuto, max 3 ogni 30 minuti,
// poi stop di 30 minuti (finestra scorrevole). Anti mail-bombing.
const mailSends = new Map<string, number[]>();
const MAIL_WINDOW_MS = 30 * 60 * 1000;
const MAIL_MAX_PER_WINDOW = 3;
const MAIL_MIN_INTERVAL_MS = 60 * 1000;

export function checkEmailQuota(key: string): RateLimitResult {
  const now = Date.now();
  const sends = (mailSends.get(key) ?? []).filter((t) => now - t < MAIL_WINDOW_MS);
  const last = sends.length > 0 ? sends[sends.length - 1] : 0;
  if (sends.length >= MAIL_MAX_PER_WINDOW || now - last < MAIL_MIN_INTERVAL_MS) {
    const retryAfterSec = Math.max(
      sends.length >= MAIL_MAX_PER_WINDOW
        ? Math.ceil((sends[0] + MAIL_WINDOW_MS - now) / 1000)
        : Math.ceil((last + MAIL_MIN_INTERVAL_MS - now) / 1000),
      1
    );
    mailSends.set(key, sends);
    return { allowed: false, retryAfterSec };
  }
  sends.push(now);
  mailSends.set(key, sends);
  return { allowed: true, retryAfterSec: 0 };
}

// Solo per i test: azzera i contatori.
export function __resetRateLimitsForTests(): void {
  buckets.clear();
  mailSends.clear();
}
