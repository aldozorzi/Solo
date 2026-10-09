-- AlterTable
ALTER TABLE "User" ADD COLUMN     "zeroKnowledgeActivatedAt" TIMESTAMP(3),
ADD COLUMN     "zeroKnowledgeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "UserKey" ADD COLUMN     "zeroKnowledgeMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zkSalt" TEXT;
