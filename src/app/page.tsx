import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import Dashboard from "@/components/Dashboard";

export default async function Home() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    redirect("/login");
  }
  
  return (
    <div className="min-h-screen bg-gradient-app">
      <div className="container mx-auto px-4 py-8">
        <Dashboard />
      </div>
    </div>
  );
}