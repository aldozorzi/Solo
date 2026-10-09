import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createRecoveryToken, type RecoveryTokenType } from "@/lib/account-recovery";
import { sendMail } from "@/lib/mail";
import { mfaResetMail, passwordResetMail, setupAccountMail, zkPasswordResetMail } from "@/lib/mail-templates";
import { checkEmailQuota, checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { auditEvent } from "@/lib/audit";

const forgotSchema = z.object({
  email: z.string().email().optional().default(""),
  kind: z.enum(["password", "mfa", "setup"]).optional().default("password"),
});

const KIND_TO_TOKEN: Record<string, RecoveryTokenType> = {
  password: "password_reset",
  mfa: "mfa_reset",
  setup: "setup",
};

// Solo JSON: il form richiede JavaScript.
// Risposta SEMPRE uniforme { ok: true } (salvo rate limiting): non rivela
// se l'email esiste né se la mail è partita davvero.
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const respondOk = () => NextResponse.json({ ok: true });

  const rl = checkRateLimit(`forgot:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    auditEvent({ type: "auth.login_ko", ip, details: { reason: "forgot_rate_limited" } });
    return NextResponse.json({ error: "Troppe richieste, riprova più tardi" }, { status: 429 });
  }

  let data: { email: string; kind: "password" | "mfa" | "setup" } = { email: "", kind: "password" };
  try {
    data = forgotSchema.parse(await request.json());
  } catch {
    return respondOk();
  }
  const email = data.email.trim();
  if (!email) return respondOk();

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return respondOk();

    // Il reset 2FA ha senso solo con la 2FA attiva.
    // Gli utenti Zero-Knowledge ora possono usarlo: il reset 2FA tocca solo
    // il secondo fattore, non la DEK (quindi non rompe la promessa ZK).
    if (data.kind === "mfa" && !user.totpEnabled) {
      return respondOk();
    }

    // Quota anti mail-bombing: per destinatario + tetto spray per IP.
    const quota = checkEmailQuota(`mail:${email.toLowerCase()}`);
    const spray = checkRateLimit(`mailip:${ip}`, 10, 10 * 60 * 1000);
    if (!quota.allowed || !spray.allowed) return respondOk();

    const tokenType = KIND_TO_TOKEN[data.kind];
    const token = await createRecoveryToken(user.id, tokenType);
    
    // Per utenti ZK con reset password: usiamo template dedicato
    let template;
    if (data.kind === "password" && user.zeroKnowledgeEnabled) {
      template = zkPasswordResetMail(user.name, token);
    } else if (data.kind === "mfa") {
      template = mfaResetMail(user.name, token);
    } else if (data.kind === "setup") {
      template = setupAccountMail(user.name, token);
    } else {
      template = passwordResetMail(user.name, token);
    }

    // Fire-and-forget: la risposta resta uniforme e veloce in entrambi i rami.
    void sendMail({ to: user.email, ...template }).then((result) => {
      if (result.sent) {
        auditEvent({
          type: "auth.password_reset_requested",
          target: user.id,
          ip,
          details: { kind: data.kind },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/auth/forgot-password:", error);
    return respondOk();
  }
}
