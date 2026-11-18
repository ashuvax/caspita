; תוכנת ההתקנה של Caspita — נבנית ב-scripts/build-win.js (מעביר VERSION, STAGE, OUTFILE, ICON).
; התקנה למשתמש הנוכחי בלבד (בלי הרשאות מנהל) ל-%LOCALAPPDATA%\Programs\Caspita.
; הנתונים (%APPDATA%\Caspita) לא נמחקים בהסרה.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"

Name "Caspita"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Caspita"
InstallDirRegKey HKCU "Software\Caspita" "InstallDir"
RequestExecutionLevel user
BrandingText "Caspita ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1037 "ProductName" "Caspita"
VIAddVersionKey /LANG=1037 "FileDescription" "Caspita — התקנה"
VIAddVersionKey /LANG=1037 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1037 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1037 "LegalCopyright" "Caspita"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Caspita.exe"
!define MUI_FINISHPAGE_RUN_TEXT "הפעל את Caspita"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Hebrew"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Caspita"

; עוצר כל תהליך שרץ מתיקיית ההתקנה (node.exe של Caspita), ומחכה עד 10 שניות שייסגר.
; הנתיב עובר במשתנה סביבה ולא בתוך הפקודה (שם משתמש בעברית / עם גרש).
; Win32_Process ולא Get-Process: ההתקנה 32 ביט מריצה PowerShell של 32 ביט, ש-Get-Process שלו
; לא רואה את הנתיב של node.exe של 64 ביט — ולכן Caspita לא נסגר והקבצים נשארו נעולים.
!macro StopRunning
  System::Call 'Kernel32::SetEnvironmentVariable(t "CASPITA_INSTDIR", t "$INSTDIR")i'
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "$$d = $$env:CASPITA_INSTDIR.TrimEnd([char]92) + [char]92; for ($$i = 0; $$i -lt 20; $$i++) { $$p = @(Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$d, [StringComparison]::OrdinalIgnoreCase) }); if ($$p.Count -eq 0) { break }; $$p | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500 }"`
  Pop $0
!macroend

Section "Caspita"
  stop:
  !insertmacro StopRunning
  ; גרסה קודמת: מוחקים את קבצי האפליקציה (לא את הנתונים) כדי שלא יישארו קבצים ישנים
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  ; קובץ נעול (Caspita עדיין פועל) — לא ממשיכים להעתקה שתיכשל באמצע
  IfFileExists "$INSTDIR\app\*.*" locked
  IfFileExists "$INSTDIR\node\*.*" locked cleaned
  locked:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION|MB_RTLREADING "Caspita עדיין פועל ולא ניתן לעדכן את הקבצים.$\r$\n$\r$\nסגור את חלון Caspita (ואם צריך — סיים את node.exe במנהל המשימות) ולחץ על נסה שנית." /SD IDCANCEL IDRETRY stop
    Abort "Caspita עדיין פועל — ההתקנה בוטלה"
  cleaned:

  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\Caspita.lnk" "$INSTDIR\Caspita.exe" "" "$INSTDIR\Caspita.ico"
  CreateShortcut "$DESKTOP\Caspita.lnk" "$INSTDIR\Caspita.exe" "" "$INSTDIR\Caspita.ico"

  WriteRegStr HKCU "Software\Caspita" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Caspita"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Caspita"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\Caspita.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro StopRunning
  Delete "$SMPROGRAMS\Caspita.lnk"
  Delete "$DESKTOP\Caspita.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\Caspita"
SectionEnd
