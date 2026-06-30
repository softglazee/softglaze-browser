; Custom NSIS hooks for SoftGlaze Browser (referenced via build.nsis.include).
; Goal: when a previous version is already installed, PROMPT the user instead of
; silently overwriting. electron-builder includes LogicLib and defines
; UNINSTALL_REGISTRY_KEY + sets SHCTX for us, so customInit can detect a prior
; install and offer Update / Uninstall-first / Cancel.

!macro customInit
  ReadRegStr $R0 SHCTX "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${if} $R0 != ""
    MessageBox MB_YESNOCANCEL|MB_ICONQUESTION "SoftGlaze Browser is already installed.$\n$\n• Yes — Update in place (keeps your profiles, proxies & settings)$\n• No — Uninstall the previous version first, then install$\n• Cancel — Quit without changes" /SD IDYES IDYES sgInitDone IDNO sgUninstallFirst
    ; Cancel → abort the installer entirely.
    Quit
    sgUninstallFirst:
      ; Best-effort synchronous uninstall of the previous version, then continue.
      ; (electron-builder also removes the old version during an update, so even if
      ; this is a no-op the install still proceeds correctly.)
      ReadRegStr $R1 SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation"
      ${if} $R1 != ""
        ExecWait '$R0 _?=$R1'
      ${else}
        ExecWait '$R0'
      ${endif}
      Goto sgInitDone
    sgInitDone:
  ${endif}
!macroend
