import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 giorni, come in authOptions
const SESSION_COOKIE = "next-auth.session-token"; // nome usato da NextAuth su HTTP

// Solo path relativi interni: niente open redirect verso host esterni.
function safeCallbackUrl(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

/**
 * Login utilizzabile anche senza JavaScript (submit nativo del form).
 * Verifica le credenziali e imposta direttamente il cookie di sessione JWT
 * nello stesso formato usato da NextAuth, così getServerSession/getToken
 * lo riconoscono senza modifiche al resto dell'app.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;

  let callbackUrl = "/";
  try {
    const form = await request.formData();
    callbackUrl = safeCallbackUrl(form.get("callbackUrl"));
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");

    const fail = () =>
      NextResponse.redirect(
        new URL(`/login?error=CredentialsSignin&callbackUrl=${encodeURIComponent(callbackUrl)}`, request.url),
        { status: 303 }
      );

    if (!secret || !email || !password) return fail();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return fail();
    if (!(await verifyPassword(password, user.passwordHash))) return fail();

    // Stessi campi che il callback jwt() di authOptions mette nel token al login.
    const token = {
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
    };
    const encoded = await encode({ token, secret, maxAge: SESSION_MAX_AGE });

    const res = NextResponse.redirect(new URL(callbackUrl, request.url), { status: 303 });
    res.cookies.set(SESSION_COOKIE, encoded, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (error) {
    console.error("Error in /api/login:", error);
    return NextResponse.redirect(
      new URL(`/login?error=Configuration&callbackUrl=${encodeURIComponent(callbackUrl)}`, request.url),
      { status: 303 }
    );
  }
}
