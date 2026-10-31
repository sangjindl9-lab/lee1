; WebNVR 윈도우 설치 프로그램 (NSIS 3, 유니코드)
; makensis -INPUTCHARSET UTF8 -DVERSION=x -DSTAGE=<stage\WebNVR> -DOUTFILE=<exe> installer.nsi
Unicode true
ManifestDPIAware true
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include x64.nsh
!include Sections.nsh
!include WinVer.nsh

Name "WebNVR ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\WebNVR"
InstallDirRegKey HKLM "Software\WebNVR" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "WebNVR ${VERSION}"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "WebNVR"
VIAddVersionKey /LANG=1042 "FileDescription" "WebNVR 영상관제 설치 프로그램"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "WebNVR"

!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\WebNVR"
!define WV2KEY "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define MUI_ICON "${STAGE}\webnvr.ico"
!define MUI_UNICON "${STAGE}\webnvr.ico"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_WELCOMEPAGE_TITLE "WebNVR ${VERSION} 설치"
!define MUI_WELCOMEPAGE_TEXT "여러 제조사 IP 카메라를 ONVIF·RTSP 로 연결해 녹화하고, 관제 프로그램·웹 브라우저로 실시간 감시·검색·재생하는 영상관제 소프트웨어입니다.$\r$\n$\r$\n• 녹화 서버: 이 PC 에서 24시간 녹화(윈도우 서비스, 로그인하지 않아도 동작)$\r$\n• 관제 프로그램: 서버에 접속해 관제·영상벽(여러 모니터)$\r$\n$\r$\n관제원 PC 에는 ‘관제 프로그램만’ 설치하세요."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "관제 프로그램 실행"
!define MUI_FINISHPAGE_RUN_FUNCTION RunClient
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\설치·운영 안내.md"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "설치·운영 안내 보기"
!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED

Var Upgrade
Var RecDir
Var Addr
Var AdmUser
Var AdmPw
Var AdmPw2
Var hRec
Var hAddr
Var hUser
Var hPw
Var hPw2

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\licenses\THIRD-PARTY.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
Page custom ServerPage ServerPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Korean"

InstType "녹화 서버 + 관제 프로그램"
InstType "관제 프로그램만(관제원 PC)"

; ───────────────────────── 공통 ─────────────────────────
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "64비트 윈도우 10/11 에서만 설치할 수 있습니다."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_ICONSTOP "윈도우 10 이상이 필요합니다."
    Abort
  ${EndIf}
  SetRegView 64
  StrCpy $Upgrade "0"
  ReadRegStr $0 HKLM "Software\WebNVR" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\data-path.txt"
    StrCpy $Upgrade "1"
  ${EndIf}
  StrCpy $AdmUser "admin"
  ${If} ${FileExists} "D:\*.*"
    StrCpy $RecDir "D:\WebNVR\recordings"
  ${Else}
    ReadEnvStr $0 PROGRAMDATA
    StrCpy $RecDir "$0\WebNVR\recordings"
  ${EndIf}
FunctionEnd

Function StopRunning
  ; 설치 폴더의 파이썬(관리 아이콘·관제 프로그램)을 닫는다 — 파일 잠김 방지
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
FunctionEnd

Function RunClient
  ; 설치 프로그램(관리자)이 아닌 일반 사용자 권한으로 실행
  Exec '"$WINDIR\explorer.exe" "$SMPROGRAMS\WebNVR\WebNVR 관제.lnk"'
FunctionEnd

; ───────────────────────── 서버 설정 화면 ─────────────────────────
Function ServerPage
  ${IfNot} ${SectionIsSelected} 1 ; 1 = SecServer(구성 요소 순서)
    Abort
  ${EndIf}
  ${If} $Upgrade == "1"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "녹화 서버 설정" "녹화 저장 위치와 최고관리자 계정을 정합니다."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 12u "녹화 저장 폴더(전용 디스크 권장 — 공간이 모자라면 오래된 영상부터 지웁니다)"
  ${NSD_CreateText} 0 13u 80% 12u $RecDir
  Pop $hRec
  ${NSD_CreateBrowseButton} 82% 12u 18% 14u "찾아보기…"
  Pop $0
  ${NSD_OnClick} $0 BrowseRec
  ${NSD_CreateLabel} 0 32u 100% 12u "접속 주소(이 PC 의 IP 또는 도메인, 비우면 자동 감지)"
  ${NSD_CreateText} 0 45u 60% 12u $Addr
  Pop $hAddr
  ${NSD_CreateLabel} 0 64u 100% 12u "최고관리자 ID"
  ${NSD_CreateText} 0 77u 40% 12u $AdmUser
  Pop $hUser
  ${NSD_CreateLabel} 0 96u 100% 12u "비밀번호(10자 이상, 영문 대·소문자·숫자·특수문자 중 3종류 이상, ID 포함 금지)"
  ${NSD_CreatePassword} 0 109u 40% 12u ""
  Pop $hPw
  ${NSD_CreateLabel} 42% 110u 18% 12u "확인"
  ${NSD_CreatePassword} 55% 109u 40% 12u ""
  Pop $hPw2
  ${NSD_CreateLabel} 0 128u 100% 20u "첫 로그인 때 비밀번호를 한 번 더 바꾸게 됩니다. 이 비밀번호는 설치 후 바로 지워지며 어디에도 저장되지 않습니다(암호화된 형태로만 DB 에 저장)."
  nsDialogs::Show
FunctionEnd

Function BrowseRec
  ${NSD_GetText} $hRec $0
  nsDialogs::SelectFolderDialog "녹화 저장 폴더" $0
  Pop $0
  ${If} $0 != "error"
    ${NSD_SetText} $hRec "$0\WebNVR\recordings"
  ${EndIf}
FunctionEnd

Function CountClasses ; 입력 $0 = 문자열, 출력 $1 = 문자 종류 수(소·대·숫자·특수), $2 = 비ASCII 포함 여부
  StrCpy $R1 0
  StrCpy $R2 0
  StrCpy $R3 0
  StrCpy $R4 0
  StrCpy $2 0
  StrLen $R9 $0
  StrCpy $R8 0
  ${While} $R8 < $R9
    StrCpy $R7 $0 1 $R8
    ${If} $R7 S>= "a"
    ${AndIf} $R7 S<= "z"
      StrCpy $R1 1
    ${ElseIf} $R7 S>= "A"
    ${AndIf} $R7 S<= "Z"
      StrCpy $R2 1
    ${ElseIf} $R7 S>= "0"
    ${AndIf} $R7 S<= "9"
      StrCpy $R3 1
    ${ElseIf} $R7 S>= "!"
    ${AndIf} $R7 S<= "~"
      StrCpy $R4 1
    ${Else}
      StrCpy $2 1
    ${EndIf}
    IntOp $R8 $R8 + 1
  ${EndWhile}
  IntOp $1 $R1 + $R2
  IntOp $1 $1 + $R3
  IntOp $1 $1 + $R4
FunctionEnd

Function ServerPageLeave
  ${NSD_GetText} $hRec $RecDir
  ${NSD_GetText} $hAddr $Addr
  ${NSD_GetText} $hUser $AdmUser
  ${NSD_GetText} $hPw $AdmPw
  ${NSD_GetText} $hPw2 $AdmPw2
  ${If} $RecDir == ""
    MessageBox MB_ICONEXCLAMATION "녹화 저장 폴더를 정하세요."
    Abort
  ${EndIf}
  ${If} $AdmUser == ""
    MessageBox MB_ICONEXCLAMATION "최고관리자 ID 를 입력하세요."
    Abort
  ${EndIf}
  ${If} $AdmPw != $AdmPw2
    MessageBox MB_ICONEXCLAMATION "비밀번호와 확인이 다릅니다."
    Abort
  ${EndIf}
  StrLen $0 $AdmPw
  ${If} $0 < 10
    MessageBox MB_ICONEXCLAMATION "비밀번호는 10자 이상이어야 합니다."
    Abort
  ${EndIf}
  StrCpy $0 $AdmPw
  Call CountClasses
  ${If} $2 == 1
    MessageBox MB_ICONEXCLAMATION "비밀번호에는 영문·숫자·키보드 특수문자만 쓰세요(한글·공백 제외)."
    Abort
  ${EndIf}
  ${If} $1 < 3
    MessageBox MB_ICONEXCLAMATION "영문 대문자·소문자·숫자·특수문자 중 3종류 이상을 사용하세요."
    Abort
  ${EndIf}
FunctionEnd

; ───────────────────────── 구성 요소 ─────────────────────────
Section "-공통 파일" SecCore
  SectionIn 1 2 RO
  SetRegView 64
  SetShellVarContext all
  ${If} ${FileExists} "$INSTDIR\data-path.txt"
  ${AndIf} ${FileExists} "$INSTDIR\python\python.exe"
    DetailPrint "기존 서비스를 정지합니다(업데이트)…"
    SetOutPath "$INSTDIR\app\backend"
    nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m nvr.winctl stop'
    Pop $0
  ${EndIf}
  Call StopRunning
  ; 이전 버전 파일 정리(데이터 폴더는 건드리지 않음)
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\python"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\python"
  File /r "${STAGE}\app"
  File /r "${STAGE}\licenses"
  File "${STAGE}\webnvr.ico"
  File "${STAGE}\VERSION"
  File "${STAGE}\설치·운영 안내.md"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\WebNVR" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\WebNVR" "Version" "${VERSION}"
  WriteRegStr HKLM "${UNINST}" "DisplayName" "WebNVR 영상관제"
  WriteRegStr HKLM "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST}" "Publisher" "WebNVR"
  WriteRegStr HKLM "${UNINST}" "DisplayIcon" "$INSTDIR\webnvr.ico"
  WriteRegStr HKLM "${UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKLM "${UNINST}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST}" "NoRepair" 1
SectionEnd

Section "녹화 서버" SecServer
  SectionIn 1
  SetRegView 64
  SetShellVarContext all
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\bin"
  File /r "${STAGE}\pgsql"
  File /r "${STAGE}\models"
  File "${STAGE}\nvrctl.cmd"
  SetOutPath "$INSTDIR\app\backend"
  ${If} $Upgrade == "1"
    DetailPrint "업데이트: DB 구조·서비스 정의를 갱신하고 다시 시작합니다…"
    nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m nvr.winctl upgrade'
    Pop $0
  ${Else}
    DetailPrint "최초 설정: DB 초기화·서비스 등록·방화벽·인증서(수 분 걸릴 수 있음)…"
    InitPluginsDir
    FileOpen $1 "$PLUGINSDIR\adm.txt" w
    FileWrite $1 $AdmPw
    FileClose $1
    StrCpy $AdmPw ""
    StrCpy $AdmPw2 ""
    ${If} $Addr == ""
      nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m nvr.winctl setup --recordings "$RecDir" --admin-user "$AdmUser" --admin-password-file "$PLUGINSDIR\adm.txt"'
    ${Else}
      nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m nvr.winctl setup --recordings "$RecDir" --address "$Addr" --admin-user "$AdmUser" --admin-password-file "$PLUGINSDIR\adm.txt"'
    ${EndIf}
    Pop $0
    Delete "$PLUGINSDIR\adm.txt"
  ${EndIf}
  ${If} $0 != 0
    MessageBox MB_ICONEXCLAMATION "서버 설정 중 오류가 났습니다(코드 $0). 설치 내용 창의 메시지를 확인한 뒤,$\r$\n관리자 명령 프롬프트에서 '$INSTDIR\nvrctl.cmd status' 로 상태를 보거나 'nvrctl upgrade' 로 다시 시도하세요."
  ${EndIf}
  ; 서버 관리 아이콘(로그인 시 자동 실행)
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebNVR 서버 관리" '"$INSTDIR\python\pythonw.exe" -m nvr.wintray'
  CreateDirectory "$SMPROGRAMS\WebNVR"
  CreateShortcut "$SMPROGRAMS\WebNVR\WebNVR 서버 관리.lnk" "$INSTDIR\python\pythonw.exe" "-m nvr.wintray" "$INSTDIR\webnvr.ico"
  CreateShortcut "$SMPROGRAMS\WebNVR\WebNVR 관리 명령(nvrctl).lnk" "$SYSDIR\cmd.exe" '/k cd /d "$INSTDIR" && nvrctl status' "$INSTDIR\webnvr.ico"
  Exec '"$WINDIR\explorer.exe" "$SMPROGRAMS\WebNVR\WebNVR 서버 관리.lnk"'
SectionEnd

Section "관제 프로그램" SecClient
  SectionIn 1 2
  SetRegView 64
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\WebNVR"
  CreateShortcut "$SMPROGRAMS\WebNVR\WebNVR 관제.lnk" "$INSTDIR\python\pythonw.exe" "-m nvr.winclient" "$INSTDIR\webnvr.ico"
  CreateShortcut "$DESKTOP\WebNVR 관제.lnk" "$INSTDIR\python\pythonw.exe" "-m nvr.winclient" "$INSTDIR\webnvr.ico"
  CreateShortcut "$SMPROGRAMS\WebNVR\설치·운영 안내.lnk" "$INSTDIR\설치·운영 안내.md"
  CreateShortcut "$SMPROGRAMS\WebNVR\WebNVR 제거.lnk" "$INSTDIR\uninstall.exe"
  ReadRegStr $0 HKLM "${WV2KEY}" "pv"
  ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $0 == ""
  ${AndIf} $1 == ""
    MessageBox MB_ICONINFORMATION "관제 프로그램은 Microsoft Edge WebView2 런타임을 사용합니다. 이 PC 에서 확인되지 않았습니다.$\r$\n관제 프로그램이 열리지 않으면 Microsoft 웹사이트에서 'WebView2 Runtime' 을 설치하세요(윈도우 11 은 기본 포함)."
  ${EndIf}
SectionEnd

LangString DESC_SecServer ${LANG_KOREAN} "이 PC 를 녹화 서버로 씁니다: DB·녹화·영상 중계·지능형 분석·웹 접속을 윈도우 서비스로 등록하고 방화벽(443·80·8189)을 엽니다."
LangString DESC_SecClient ${LANG_KOREAN} "관제 프로그램(창·영상벽)과 바로가기를 설치합니다."
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecServer} $(DESC_SecServer)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecClient} $(DESC_SecClient)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ───────────────────────── 제거 ─────────────────────────
Section "Uninstall"
  SetRegView 64
  SetShellVarContext all
  Call un.StopRunning
  ${If} ${FileExists} "$INSTDIR\data-path.txt"
    StrCpy $1 ""
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "설정·DB·로그(데이터 폴더)도 삭제할까요?$\r$\n‘아니요’를 누르면 남겨 두어 다시 설치할 때 그대로 씁니다.$\r$\n※ 녹화 영상 폴더는 어느 경우에도 삭제하지 않습니다." IDNO +2
      StrCpy $1 "--purge"
    SetOutPath "$INSTDIR\app\backend"
    nsExec::ExecToLog '"$INSTDIR\python\python.exe" -m nvr.winctl remove $1'
    Pop $0
    SetOutPath "$TEMP"
  ${EndIf}
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "WebNVR 서버 관리"
  Delete "$DESKTOP\WebNVR 관제.lnk"
  RMDir /r "$SMPROGRAMS\WebNVR"
  RMDir /r "$INSTDIR\python"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\bin"
  RMDir /r "$INSTDIR\pgsql"
  RMDir /r "$INSTDIR\models"
  RMDir /r "$INSTDIR\licenses"
  Delete "$INSTDIR\*.*"
  RMDir "$INSTDIR"
  DeleteRegKey HKLM "${UNINST}"
  DeleteRegKey HKLM "Software\WebNVR"
SectionEnd

Function un.StopRunning
  nsExec::Exec `powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process python,pythonw -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
FunctionEnd
