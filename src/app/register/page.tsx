import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import RegisterForm from "./RegisterForm";

// Sempre dinamica: niente prerender e nessuna dipendenza dal DB in build.
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const userCount = await prisma.user.count();
  
  if (userCount > 0) {
    redirect("/login");
  }
  
  return <RegisterForm />;
}