# Generate a SELF-SIGNED code-signing certificate to DRY-RUN the Windows signing
# pipeline (electron-builder). A self-signed cert is NOT trusted by SmartScreen —
# it only proves the build signs correctly. Buy a real OV/EV certificate for release.
#
# Usage:
#   .\scripts\gen-selfsigned-cert.ps1 -Password "test1234"
# Then:
#   $env:CSC_LINK = "build\selfsigned.pfx"
#   $env:CSC_KEY_PASSWORD = "test1234"
#   npm run build:electron        # produces a (self-)signed installer
param(
  [string]$Password = "test1234",
  [string]$Out = "build\selfsigned.pfx",
  [string]$Subject = "CN=SoftGlaze Test (DO NOT SHIP)"
)

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
  -CertStoreLocation "Cert:\CurrentUser\My" -KeyUsage DigitalSignature -KeyExportPolicy Exportable

$sec = ConvertTo-SecureString -String $Password -Force -AsPlainText
New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
Export-PfxCertificate -Cert $cert -FilePath $Out -Password $sec | Out-Null

Write-Host "Self-signed code-signing cert written to: $Out"
Write-Host ""
Write-Host "Dry-run signing with:" -ForegroundColor Cyan
Write-Host "  `$env:CSC_LINK = '$Out'"
Write-Host "  `$env:CSC_KEY_PASSWORD = '$Password'"
Write-Host "  npm run build:electron"
Write-Host ""
Write-Host "NOTE: self-signed = SmartScreen will still warn. Buy a real OV/EV cert before release." -ForegroundColor Yellow

# Remove the cert from the user store (the .pfx is what the build uses).
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue
