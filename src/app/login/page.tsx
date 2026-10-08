import { prisma } from "@/lib/prisma";
import { Suspense } from "react";
import LoginForm from "./LoginForm";

// Sempre dinamica: niente prerender e nessuna dipendenza dal DB in build.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const userCount = await prisma.user.count();

  return (
    <div className="min-h-screen bg-gradient-app flex items-center justify-center p-4">
      <Suspense fallback={<div className="w-full max-w-md"><div className="animate-pulse h-96 bg-muted rounded-xl" /></div>}>
        <LoginForm showRegisterLink={userCount === 0} />
      </Suspense>
    </div>
  );
}