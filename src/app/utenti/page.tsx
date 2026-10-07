import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";
import type { UserSession } from "@/types";

export const dynamic = "force-dynamic";

export default async function UtentiPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/login");
  }

  if ((session.user as UserSession).role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-gradient-app">
      <div className="container mx-auto px-4 py-8">
        <Dashboard initialSection="users" />
      </div>
    </div>
  );
}
