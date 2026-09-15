-- Rename stored browser engine identifiers to "Chromium" and "Firefox".
-- The old names are matched here only so existing rows can be rewritten.
-- Profiles: the old Chromium label, the generator's former "Chrome", and empty
-- values (which the launcher already routes to Chromium) all become "Chromium".
UPDATE "Profile" SET "browserCore" = 'Chromium' WHERE "browserCore" IS NULL OR "browserCore" IN ('', 'SunBrowser', 'Chrome');
UPDATE "Profile" SET "browserCore" = 'Firefox' WHERE "browserCore" = 'FlowerBrowser';
-- Templates hold a JSON snapshot written with JSON.stringify (no whitespace).
UPDATE "Template" SET "dataJson" = REPLACE(REPLACE(REPLACE("dataJson", '"browserCore":"SunBrowser"', '"browserCore":"Chromium"'), '"browserCore":"Chrome"', '"browserCore":"Chromium"'), '"browserCore":"FlowerBrowser"', '"browserCore":"Firefox"') WHERE "dataJson" LIKE '%"browserCore":"SunBrowser"%' OR "dataJson" LIKE '%"browserCore":"Chrome"%' OR "dataJson" LIKE '%"browserCore":"FlowerBrowser"%';
