-- Identity Data Vault: personas/identities for the Smart Autofill engine.
-- The five core fields are NOT NULL DEFAULT '' so a sparse Excel/CSV import row
-- (missing a cell) never aborts the bulk insert. usedOnUrls holds a JSON array of
-- hostnames the persona has already been used on.
CREATE TABLE IF NOT EXISTS "PersonaData" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "label" TEXT,
  "firstName" TEXT NOT NULL DEFAULT '',
  "lastName" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "username" TEXT NOT NULL DEFAULT '',
  "password" TEXT NOT NULL DEFAULT '',
  "phone" TEXT,
  "dateOfBirth" TEXT,
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zipCode" TEXT,
  "country" TEXT,
  "company" TEXT,
  "usedOnUrls" TEXT NOT NULL DEFAULT '[]',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PersonaData_createdAt_idx" ON "PersonaData"("createdAt");
CREATE INDEX IF NOT EXISTS "PersonaData_email_idx" ON "PersonaData"("email");
