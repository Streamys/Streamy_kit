; Streamy Kit 설치 파일 (NSIS 3, Unicode)
; Streamy Kit is based on the OBS Studio engine (GPL-2.0-or-later).
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!define APPNAME "Streamy Kit"
!define COMPANY "Streamy"
!ifndef VERSION
  !define VERSION "0.2.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "..\dist\Streamy Kit-win32-x64"
!endif
!define EXE "Streamy Kit.exe"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\StreamyKit"

Name "${APPNAME}"
OutFile "..\dist\StreamyKit-Setup-${VERSION}-x64.exe"
InstallDir "$PROGRAMFILES64\${APPNAME}"
InstallDirRegKey HKLM "Software\${COMPANY}\${APPNAME}" "InstallDir"
RequestExecutionLevel admin
BrandingText "Streamy Kit ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1042 "CompanyName" "${COMPANY}"
VIAddVersionKey /LANG=1042 "FileDescription" "Streamy Kit 설치 프로그램"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "GPL-2.0-or-later (OBS Studio 엔진 기반)"

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var Relaunch

!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "LICENSE.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Korean"
!insertmacro MUI_LANGUAGE "English"

LangString RunText 1042 "Streamy Kit 실행하기"
LangString RunText 1033 "Launch Streamy Kit"
LangString SecDesktop 1042 "바탕화면 바로가기"
LangString SecDesktop 1033 "Desktop shortcut"
LangString VCText 1042 "Visual C++ 런타임 설치 중..."
LangString VCText 1033 "Installing Visual C++ runtime..."
LangString NeedX64 1042 "Streamy Kit은 64비트 윈도우 10 이상에서만 설치할 수 있어요."
LangString NeedX64 1033 "Streamy Kit requires 64-bit Windows 10 or later."
LangString Running 1042 "Streamy Kit이 실행 중이에요. 종료한 뒤 다시 시도해 주세요."
LangString Running 1033 "Streamy Kit is running. Please close it and try again."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(NeedX64)" /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
  ; 앱 안 업데이트: /S /relaunch 로 실행됨 → 설치 끝나면 다시 켬
  StrCpy $Relaunch 0
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/relaunch" $R1
  ${IfNot} ${Errors}
    StrCpy $Relaunch 1
  ${EndIf}
  ; 이미 설치된 위치가 있으면 그대로 사용
  ReadRegStr $R2 HKLM "Software\${COMPANY}\${APPNAME}" "InstallDir"
  ${If} $R2 != ""
    StrCpy $INSTDIR $R2
  ${EndIf}
  !insertmacro MUI_LANGDLL_DISPLAY
FunctionEnd

Function .onInstSuccess
  ${If} $Relaunch == 1
    ; 설치 파일은 관리자 권한이라, 탐색기를 통해 일반 사용자 권한으로 다시 켬
    Exec '"$WINDIR\explorer.exe" "$INSTDIR\${EXE}"'
  ${EndIf}
FunctionEnd

Function IsRunning
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE}" /NH | find /I "${EXE}"'
  Pop $0
  Pop $1
FunctionEnd

Function CheckRunning
  ; 업데이트(조용한 설치)면: 앱이 스스로 꺼질 때까지 최대 20초 기다린 뒤, 그래도 남아 있으면 강제 종료
  ${If} ${Silent}
    StrCpy $2 0
    ${Do}
      Call IsRunning
      ${If} $0 != 0
        ${Break}
      ${EndIf}
      IntOp $2 $2 + 1
      ${If} $2 > 40
        nsExec::Exec 'taskkill /F /IM "${EXE}"'
        Sleep 1500
        ${Break}
      ${EndIf}
      Sleep 500
    ${Loop}
    Return
  ${EndIf}
  ; 일반 설치: 실행 중이면 안내
  Call IsRunning
  ${If} $0 == 0
    MessageBox MB_ICONEXCLAMATION|MB_RETRYCANCEL "$(Running)" IDRETRY retry
    Abort
    retry:
    Call CheckRunning
  ${EndIf}
FunctionEnd

Section "Streamy Kit" SecMain
  SectionIn RO
  Call CheckRunning
  SetOutPath "$INSTDIR"
  ; 이전 버전 파일 정리 (사용자 설정은 %APPDATA%에 있어서 지워지지 않음)
  RMDir /r "$INSTDIR\resources"
  File /r "${SRCDIR}\*.*"
  File "icon.ico"
  File "LICENSE.txt"
  File "NOTICE.txt"

  ; Visual C++ 런타임 (없을 때만)
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != 1
    DetailPrint "$(VCText)"
    SetOutPath "$PLUGINSDIR"
    File "vc_redist.x64.exe"
    ExecWait '"$PLUGINSDIR\vc_redist.x64.exe" /install /quiet /norestart'
    SetOutPath "$INSTDIR"
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\${APPNAME}\오픈소스 고지.lnk" "$INSTDIR\NOTICE.txt"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME} 제거.lnk" "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "Software\${COMPANY}\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINST_KEY}" "URLInfoAbout" "https://github.com/Streamys/Streamy_kit"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
  WriteUninstaller "$INSTDIR\Uninstall.exe"
SectionEnd

Section "$(SecDesktop)" SecDesktopShortcut
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico" 0
SectionEnd

Section "Uninstall"
  SetRegView 64
  nsExec::Exec 'taskkill /F /IM "${EXE}"'
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${COMPANY}\${APPNAME}"
  ; 사용자 설정(%APPDATA%\Streamy Kit)과 녹화 파일은 지우지 않음
SectionEnd
