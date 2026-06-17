-- CreateTable
CREATE TABLE "Proxy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'HTTP',
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "proxyId" INTEGER,
    "proxyInfoString" TEXT,
    "notes" TEXT,
    "tagManagement" INTEGER NOT NULL DEFAULT 0,
    "systemProxyBehavior" TEXT NOT NULL DEFAULT 'PROFILE_PROXY',
    "dataDirName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "groupId" TEXT,
    "browserCore" TEXT,
    "browserVersion" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "userAgent" TEXT,
    "startupUrls" TEXT,
    "platformAccounts" TEXT,
    "webrtc" TEXT,
    "timezoneType" TEXT,
    "timezoneCustom" TEXT,
    "locationType" TEXT,
    "locationPrompt" TEXT,
    "locationLat" TEXT,
    "locationLng" TEXT,
    "locationAcc" TEXT,
    "languageType" TEXT,
    "languageCustom" TEXT,
    "displayLangType" TEXT,
    "displayLangCustom" TEXT,
    "resolutionType" TEXT,
    "resolutionW" TEXT,
    "resolutionH" TEXT,
    "fontsType" TEXT,
    "canvasNoise" BOOLEAN,
    "webglImageNoise" BOOLEAN,
    "audioContextNoise" BOOLEAN,
    "clientRectsNoise" BOOLEAN,
    "speechVoicesNoise" BOOLEAN,
    "mediaDevice" TEXT,
    "webglMetadata" TEXT,
    "webglVendor" TEXT,
    "webglRenderer" TEXT,
    "webgpu" TEXT,
    "cpuType" TEXT,
    "cpuCores" TEXT,
    "ramType" TEXT,
    "ramGb" TEXT,
    "deviceNameType" TEXT,
    "deviceName" TEXT,
    "macAddressType" TEXT,
    "macAddress" TEXT,
    "doNotTrack" TEXT,
    "portScanProtection" TEXT,
    "hardwareAcceleration" TEXT,
    "disableTls" TEXT,
    "launchArgs" TEXT,
    "advancedExt" TEXT,
    "advancedSync" TEXT,
    "syncItemsJson" TEXT,
    "advancedBrowser" TEXT,
    "browserSettingsJson" TEXT,
    "randomFingerprint" BOOLEAN,
    CONSTRAINT "Profile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Profile_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Proxy" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Proxy_host_port_idx" ON "Proxy"("host", "port");

-- CreateIndex
CREATE INDEX "Proxy_createdAt_idx" ON "Proxy"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Proxy_type_host_port_username_key" ON "Proxy"("type", "host", "port", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_dataDirName_key" ON "Profile"("dataDirName");

-- CreateIndex
CREATE INDEX "Profile_proxyId_idx" ON "Profile"("proxyId");

-- CreateIndex
CREATE INDEX "Profile_groupId_idx" ON "Profile"("groupId");

-- CreateIndex
CREATE INDEX "Profile_createdAt_idx" ON "Profile"("createdAt");
