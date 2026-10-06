import { DefaultSession, DefaultUser } from "next-auth";
import { JWT, DefaultJWT } from "next-auth/jwt";
import { UserRole, TaxRegime } from "@/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      businessName: string;
      vatNumber: string;
      taxCode: string;
      address: string;
      city: string;
      zipCode: string;
      country: string;
      province?: string | null;
      taxRegime: TaxRegime;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: UserRole;
    businessName: string;
    vatNumber: string;
    taxCode: string;
    address: string;
    city: string;
    zipCode: string;
    country: string;
    province?: string | null;
    taxRegime: TaxRegime;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    role: UserRole;
    businessName: string;
    vatNumber: string;
    taxCode: string;
    address: string;
    city: string;
    zipCode: string;
    country: string;
    province?: string | null;
    taxRegime: TaxRegime;
  }
}