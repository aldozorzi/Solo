import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { consumeRecoveryToken, invalidateUserRecoveryTokens } from "@/lib/account-recovery";
import { sendMail } from "@/lib/mail";
import { securityNoticeMail } from "@/lib/mail-templates";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { auditEvent } from "@/lib/audit";

const resetMfaSchema = z.object({
  token: z.string().min(1),
});

// Disattiva la 2FA tramite token da email (l'utente dovrà riattivarla dalle
// Impostazioni). Uniforme in caso di token invalido/scaduto/riusato. Solo JSON.
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = () => NextResponse.json({ error: "InvalidToken" }, { status: 400 });

  const rl = checkRateLimit(`reset:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "RateLimited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail();
  }
  const parsed = resetMfaSchema.safeParse({ token: String(body.token || "") });
  if (!parsed.success) return fail();

  try {
    const claimed = await consumeRecoveryToken(parsed.data.token, "mfa_reset");
    if (!claimed) return fail();

    const user = await prisma.user.findUnique({ where: { id: claimed.userId } });
    if (!user) return fail();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: [],
        sessionVersion: { increment: 1 },
      },
    });
    await invalidateUserRecoveryTokens(user.id);

    auditEvent({ type: "auth.mfa_reset_completed", actor: user.id, target: user.id, ip });
    void sendMail({
      to: user.email,
      ...securityNoticeMail(
        user.name,
        `la verifica in due passaggi del tuo account è stata disattivata il ${new Date().toLocaleString("it-IT")}. Riattivala dalle Impostazioni.`
      ),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/auth/reset-mfa:", error);
    return fail();
  }
}
