import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

export const config = {
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|login|register).*)",
  ],
};

export default async function proxy(req: NextRequest) {
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const path = req.nextUrl.pathname;
  const method = req.method;

  const publicPaths = ["/login", "/register"];
  const authApiPaths = path.startsWith("/api/auth");

  if (publicPaths.includes(path) || authApiPaths) {
    return new Response(null, { status: 200, headers: { "x-middleware-next": "1" } });
  }

  if (path === "/api/users" && method === "POST") {
    return new Response(null, { status: 200, headers: { "x-middleware-next": "1" } });
  }

  // Login nativo (senza JS): deve passare senza sessione, come la registrazione.
  if (path === "/api/login" && method === "POST") {
    return new Response(null, { status: 200, headers: { "x-middleware-next": "1" } });
  }

  if (path.startsWith("/api/users") && method !== "POST") {
    if (token?.role !== "ADMIN") {
      return new Response(
        JSON.stringify({ error: "Accesso negato: solo amministratori" }),
        { status: 403, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(null, { status: 200, headers: { "x-middleware-next": "1" } });
  }

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", path);
    return Response.redirect(loginUrl);
  }

  const headers = new Headers();
  headers.set("x-user-id", token.id as string);
  headers.set("x-user-role", token.role as string);
  headers.set("x-user-email", token.email as string);
  headers.set("x-middleware-next", "1");

  return new Response(null, { status: 200, headers });
}