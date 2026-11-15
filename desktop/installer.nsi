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

; עוצר את Caspita אם הוא רץ מתיקיית ההתקנה (ה-node.exe שלו בלבד)
!macro StopRunning
  nsExec::Exec `powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq '$INSTDIR\node\node.exe' } | Stop-Process -Force"`
  Pop $0
  Sleep 800
!macroend

Section "Caspita"
  !insertmacro StopRunning
  ; גרסה קודמת: מוחקים את קבצי האפליקציה (לא את הנתונים) כדי שלא יישארו קבצים ישנים
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"

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
