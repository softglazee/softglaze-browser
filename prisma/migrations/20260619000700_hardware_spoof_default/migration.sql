UPDATE "Profile" SET "cpuType" = 'Custom' WHERE "cpuType" IS NULL OR "cpuType" = 'Real';
UPDATE "Profile" SET "ramType" = 'Custom' WHERE "ramType" IS NULL OR "ramType" = 'Real';
UPDATE "Profile" SET "deviceNameType" = 'Custom' WHERE "deviceNameType" IS NULL OR "deviceNameType" = 'Real';
UPDATE "Profile" SET "macAddressType" = 'Custom' WHERE "macAddressType" IS NULL OR "macAddressType" = 'Real';
