import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as NextAuthOptions["adapter"],
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email e password richieste");
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          throw new Error("Credenziali non valide");
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);

        if (!isValid) {
          throw new Error("Credenziali non valide");
        }

        return {
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
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.businessName = (user as any).businessName;
        token.vatNumber = (user as any).vatNumber;
        token.taxCode = (user as any).taxCode;
        token.address = (user as any).address;
        token.city = (user as any).city;
        token.zipCode = (user as any).zipCode;
        token.country = (user as any).country;
        token.province = (user as any).province;
        token.taxRegime = (user as any).taxRegime;
        token.senderType = (user as any).senderType;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).businessName = token.businessName;
        (session.user as any).vatNumber = token.vatNumber;
        (session.user as any).taxCode = token.taxCode;
        (session.user as any).address = token.address;
        (session.user as any).city = token.city;
        (session.user as any).zipCode = token.zipCode;
        (session.user as any).country = token.country;
        (session.user as any).province = token.province;
        (session.user as any).taxRegime = token.taxRegime;
        (session.user as any).senderType = token.senderType;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}