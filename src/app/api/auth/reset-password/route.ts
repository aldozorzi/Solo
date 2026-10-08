import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { hashPassword } from "@/lib/auth";
import { consumeRecoveryToken, invalidateUserRecoveryTokens } from "@/lib/account-recovery";
import { sendMail } from "@/lib/mail";
import { securityNoticeMail } from "@/lib/mail-templates";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { auditEvent } from "@/lib/audit";

const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12, "Password minima 12 caratteri"),
});

// Completamento setup/reset password (token da email). Vale sia per gli inviti
// setup che per i reset: in entrambi i casi l'utente imposta da sé la password.
// Solo JSON: il form richiede JavaScript.
export async function POST(request: NextRequest) {
  const ip = clientIpFromHeaders(request.headers);

  const fail = () =>
    // Uniforme: token invalido/scaduto/riusato danno tutti lo stesso esito.
    NextResponse.json({ error: "InvalidToken" }, { status: 400 });

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
  const parsed = resetSchema.safeParse({
    token: String(body.token || ""),
    newPassword: String(body.newPassword || ""),
  });
  if (!parsed.success) return fail();

  try {
    const claimed = await consumeRecoveryToken(parsed.data.token, ["setup", "password_reset"]);
    if (!claimed) return fail();

    const user = await prisma.user.findUnique({ where: { id: claimed.userId } });
    if (!user) return fail();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(parsed.data.newPassword),
        // Invalida tutte le sessioni precedenti (possibile compromissione).
        sessionVersion: { increment: 1 },
      },
    });
    await invalidateUserRecoveryTokens(user.id);

    auditEvent({
      type: claimed.type === "setup" ? "auth.setup_completed" : "auth.password_reset_completed",
      actor: user.id,
      target: user.id,
      ip,
    });
    void sendMail({
      to: user.email,
      ...securityNoticeMail(
        user.name,
        `la password del tuo account è stata modificata il ${new Date().toLocaleString("it-IT")}.`
      ),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in /api/auth/reset-password:", error);
    return fail();
  }
}
