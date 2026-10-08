import { NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

const handler = NextAuth(authOptions);

async function guarded(
  request: NextRequest,
  run: () => Promise<Response>
): Promise<Response> {
  // Solo i POST di callback/signin sono sensibili al brute-force;
  // le GET (session, providers, csrf) restano libere.
  if (request.method === "POST") {
    const ip = clientIpFromHeaders(request.headers);
    const rl = checkRateLimit(`nextauth:${ip}`, 20, 10 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Troppe richieste, riprova più tardi" }, { status: 429 });
    }
  }
  return run();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  return guarded(request, () => handler(request, context));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  return guarded(request, () => handler(request, context));
}
