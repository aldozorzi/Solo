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

        // Entrambi i rami eseguono un confronto bcrypt completo:
        // né messaggio né tempi distinguono "utente inesistente" da "password errata".
        if (!user) {
          await verifyPasswordConstantTime(credentials.password, null);
          throw new Error("Credenziali non valide");
        }

        const isValid = await verifyPasswordConstantTime(
          credentials.password,
          user.passwordHash
        );

        if (!isValid) {
          throw new Error("Credenziali non valide");
        }

        // Il flusso a due passaggi vive su /api/login: questo percorso legacy
        // non può completare la MFA, quindi per gli utenti con 2FA è chiuso.
        if (user.totpEnabled) {
          throw new Error("Verifica in due passaggi richiesta");
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
          sessionVersion: user.sessionVersion,
          mfa: !user.totpEnabled,
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
        token.sessionVersion = (user as any).sessionVersion ?? 0;
        token.mfa = (user as any).mfa ?? true;
      }
      return token;
    },
    async session({ session, token }) {
      // Enforcement centralizzato: il token è valido solo se la sua
      // sessionVersion coincide con quella corrente nel DB. Così un cambio
      // password (che incrementa la versione) invalida tutte le sessioni
      // precedenti, e i token emessi prima di questa modifica (senza versione)
      // richiedono un nuovo login. Gira a ogni getServerSession().
      const t = token as unknown as {
        sub?: string;
        sessionVersion?: unknown;
      };
      let revoked = typeof t.sessionVersion !== "number" || !t.sub;
      if (!revoked) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: t.sub as string },
            select: { sessionVersion: true },
          });
          revoked = !user || user.sessionVersion !== t.sessionVersion;
        } catch {
          // In caso di errore DB non concedere l'accesso per default.
          revoked = true;
        }
      }
      if (revoked) {
        // Sessione senza utente: tutti i guard (session?.user?.id) falliscono
        // in modo chiuso (401/redirect login), senza eccezioni 500.
        return { ...session, user: undefined } as unknown as typeof session;
      }
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
        (session.user as any).sessionVersion = (token as any).sessionVersion;
        (session.user as any).mfa = (token as any).mfa ?? true;
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

// Hash fittizio (cost 12 come quelli reali, plaintext casuale e sconosciuto):
// serve a eseguire SEMPRE il confronto bcrypt anche quando l'utente non esiste,
// così il tempo di risposta non rivela se l'email è registrata (OWASP WSTG-ATHN-02).
const DUMMY_PASSWORD_HASH =
  "$2b$12$GW08l0Qo0a0itRAmlYPepOhs0xAPl4yfyJ60NUyKomLZljJCvejaC";

export async function verifyPasswordConstantTime(
  password: string,
  hash?: string | null
): Promise<boolean> {
  const match = await bcrypt.compare(password, hash ?? DUMMY_PASSWORD_HASH);
  return !!hash && match;
}