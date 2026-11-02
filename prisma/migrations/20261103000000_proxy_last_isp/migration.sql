-- The exit network's owner from the last proxy check (ISP or hosting company), so the CAPTCHA score
-- can tell a datacenter IP from a home one.
ALTER TABLE "Proxy" ADD COLUMN "lastIsp" TEXT;
