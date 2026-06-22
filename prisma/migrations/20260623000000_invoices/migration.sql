-- Invoices: receipts for subscription payments (auto-captured from checkout /
-- manual-payment approval, plus manual entries by the Super Admin). The app's
-- migration runner tolerates an "already exists" error if the table was created
-- via prisma db push during development.
CREATE TABLE "Invoice" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "ownerMemberId" INTEGER,
  "memberId" INTEGER,
  "amount" TEXT NOT NULL DEFAULT '0',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "provider" TEXT,
  "status" TEXT NOT NULL DEFAULT 'paid',
  "reference" TEXT,
  "tier" TEXT,
  "months" INTEGER DEFAULT 1,
  "note" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paidAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Invoice_ownerMemberId_idx" ON "Invoice"("ownerMemberId");
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice"("createdAt");
