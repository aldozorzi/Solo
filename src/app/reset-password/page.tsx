import { Suspense } from "react";
import { redirect } from "next/navigation";
import { validateResetToken } from "@/lib/auth-tokens";
import ResetPasswordForm from "./ResetPasswordForm";
import ZkResetForm from "./ZkResetForm";

// Sempre dinamica: niente prerender e nessuna dipendenza dal DB in build.
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ token?: string; flow?: string }>;
}) {
  const { token, flow } = await searchParams;
  
  if (!token) {
    redirect("/login?error=InvalidToken");
  }

  // Valida token e determina se ZK
  const validation = await validateResetToken(token);
  
  if (!validation?.user) {
    redirect("/login?error=InvalidToken");
  }

  const isZK = validation.user.zeroKnowledgeEnabled;
  const isMfaFlow = flow === "mfa" && !isZK;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-app flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="animate-pulse h-96 bg-muted rounded-xl" />
          </div>
        </div>
      }
    >
      {isZK ? (
        <ZkResetForm token={token} />
      ) : (
        <ResetPasswordForm token={token} isMfaFlow={isMfaFlow} />
      )}
    </Suspense>
  );
}