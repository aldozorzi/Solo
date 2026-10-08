import { NextRequest, NextResponse } from "next/server";
import { decode, encode, type JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import type { User } from "@prisma/client";
import { verifyPasswordConstantTime } from "@/lib/auth";
import { verifyTotpCode } from "@/lib/totp";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { auditEvent, auditWebhookAlert, noteAuthFailure } from "@/lib/audit";
import { openSecret as openTotpSecret } from "@/lib/secret-box";
import bcrypt from "bcryptjs";

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 giorni, come in authOptions
const MFA_CHALLENGE_MAX_AGE = 5 * 60; // 5 minuti
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

// Stessa logica di NextAuth (getToken): cookie __Secure- solo su HTTPS,
// altrimenti nome semplice. Così resta coerente in sviluppo (HTTP) e produzione (HTTPS).
const useSecureCookies =
  process.env.NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL;
const SESSION_COOKIE = useSecureCookies
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

function setSessionCookie(res: NextResponse, encoded: string): void {
  res.cookies.set(SESSION_COOKIE, encoded, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: useSecureCookies,
    maxAge: SESSION_MAX_AGE,
  });
}

async function mintSessionToken(user: User): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET non configurata");
  // Stessi campi che il callback jwt() di authOptions mette nel token al login,
  // più sessionVersion (revoca) e mfa (secondo fattore completato).
  return encode({
    token: {
      sub: user.id,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      businessName: user.businessName,
      vatNumber: user.vatNumber,
      taxCode: user.taxCode,
      address: user.address,
      city: user.city,
      zipCode: user.zipCode,
      country: user.country,
      province: user.province,
      taxRegime: user.taxRegime,
      senderType: user.senderType,
      sessionVersion: user.sessionVersion,
      mfa: true,
    },
    secret,
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Login via fetch JSON (il form richiede JavaScript).
 * Supporta il secondo fattore (TOTP/backup code) in due passaggi:
 *  - step 1 {email,password} -> {mfaRequired,challenge} se 2FA attiva, altrimenti sessione;
 *  - step 2 {challenge,totpCode} -> sessione.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  const ip = clientIpFromHeaders(request.headers);

  const fail = (code: string, status = 401) => NextResponse.json({ error: code }, { status });
  const failConfig = () => NextResponse.json({ error: "Configuration" }, { status: 500 });

  // Rate limiting per IP (tutti gli step condividono lo stesso bucket).
  const rl = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rl.allowed) {
    auditEvent({ type: "auth.login_ko", ip, details: { reason: "rate_limited" } });
    return NextResponse.json({ error: "RateLimited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("CredentialsSignin");
  }

  try {
    if (!secret) return failConfig();

    // ---- Step 2: verifica secondo fattore ----
    if (typeof body.challenge === "string" && body.challenge) {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      let challenge: { sub?: string; stage?: string };
      try {
        challenge = (await decode({ token: body.challenge, secret })) as {
          sub?: string;
          stage?: string;
        };
      } catch {
        auditKo(email, ip, "bad_challenge");
        return fail("CredentialsSignin");
      }
      if (!challenge || challenge.stage !== "mfa" || !challenge.sub) {
        auditKo(email, ip, "bad_challenge");
        return fail("CredentialsSignin");
      }
      const user = await prisma.user.findUnique({ where: { id: challenge.sub } });
      if (!user || !user.totpEnabled || !user.totpSecret) {
        await verifyPasswordConstantTime("x", null);
        auditKo(email, ip, "mfa_user_invalid");
        return fail("CredentialsSignin");
      }
      const code = String(body.totpCode || "").trim();
      let codeOk = verifyTotpCode(await openTotpSecret(user.totpSecret), code);
      if (!codeOk && code) {
        // Prova i backup code monouso (hash bcrypt).
        for (const hash of user.totpBackupCodes) {
          if (await bcrypt.compare(code.replace(/\s+/g, "").toUpperCase(), hash)) {
            codeOk = true;
            await prisma.user.update({
              where: { id: user.id },
              data: { totpBackupCodes: user.totpBackupCodes.filter((h) => h !== hash) },
            });
            break;
          }
        }
      }
      if (!codeOk) {
        auditKo(user.email, ip, "mfa_code_invalid");
        return fail("CredentialsSignin");
      }
      const encoded = await mintSessionToken(user);
      auditEvent({ type: "auth.login_ok", actor: user.email, ip, details: { mfa: true } });
      const res = NextResponse.json({ ok: true });
      setSessionCookie(res, encoded);
      return res;
    }

    // ---- Step 1: email + password (confronto sempre eseguito: tempi uniformi) ----
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
    if (!user) {
      await verifyPasswordConstantTime(password, null);
      auditKo(email || "(vuota)", ip, "bad_credentials");
      return fail("CredentialsSignin");
    }
    if (!(await verifyPasswordConstantTime(password, user.passwordHash))) {
      auditKo(email, ip, "bad_credentials");
      return fail("CredentialsSignin");
    }

    if (user.totpEnabled) {
      const challenge = await encode({
        token: { sub: user.id, stage: "mfa" } as unknown as JWT,
        secret,
        maxAge: MFA_CHALLENGE_MAX_AGE,
      });
      auditEvent({ type: "auth.mfa_challenge", actor: user.email, ip });
      return NextResponse.json({ mfaRequired: true, challenge });
    }

    const encoded = await mintSessionToken(user);
    auditEvent({ type: "auth.login_ok", actor: user.email, ip });
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, encoded);
    return res;
  } catch (error) {
    console.error("Error in /api/login:", error);
    return failConfig();
  }
}

function auditKo(actor: string, ipAddr: string, reason: string): void {
  auditEvent({ type: "auth.login_ko", actor, ip: ipAddr, details: { reason } });
  if (noteAuthFailure(ipAddr) === "alert") {
    const alert = { type: "auth.alert_bruteforce" as const, ip: ipAddr, details: { reason } };
    auditEvent(alert);
    auditWebhookAlert(alert);
  }
}
