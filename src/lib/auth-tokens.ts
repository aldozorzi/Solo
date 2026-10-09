import { prisma } from '@/lib/prisma';
import { hashRecoveryToken as hashToken } from '@/lib/account-recovery';

interface UserKeyData {
  id: string;
  argon2Salt: string;
  wPwd: string;
  wSys: string;
  zeroKnowledgeMode: boolean;
  zkSalt: string | null;
}

interface UserWithKey {
  id: string;
  email: string;
  zeroKnowledgeEnabled: boolean;
  userKey: UserKeyData | null;
}

interface ValidationResult {
  user: UserWithKey | null;
}

export async function validateResetToken(token: string): Promise<ValidationResult> {
  if (!token || token.length !== 64) {
    return { user: null };
  }

  const tokenHash = hashToken(token);

  const tokenRowRaw = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          userKey: true,
        },
      },
    },
  });

  const tokenRow = tokenRowRaw as any;

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt < new Date()) {
    return { user: null };
  }

  const user = tokenRow.user as any;
  const userKey = user.userKey as any;

  return {
    user: {
      id: user.id,
      email: user.email,
      zeroKnowledgeEnabled: user.zeroKnowledgeEnabled,
      userKey: userKey
        ? {
            id: userKey.id,
            argon2Salt: userKey.argon2Salt,
            wPwd: userKey.wPwd,
            wSys: userKey.wSys,
            zeroKnowledgeMode: userKey.zeroKnowledgeMode,
            zkSalt: userKey.zkSalt,
          }
        : null,
    },
  };
}

export async function consumeResetToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  const result = await prisma.authToken.updateMany({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  return result.count > 0;
}