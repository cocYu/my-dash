; AtoZ 安装器自定义页：是否创建桌面快捷方式。
; 仅在 assisted 模式（electron-builder 的 oneClick: false）下生效：
;   electron-builder 会在「选择安装位置」页之后、「正在安装」页之前插入 customPageAfterChangeDir。
; 安装目录选择由 electron-builder 的 allowToChangeInstallationDirectory 负责，不在这里处理。

!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var DesktopShortcutState
!endif

!macro customInit
  ; 默认创建桌面快捷方式。页面被跳过（静默安装 / 覆盖升级）时保持默认，
  ; 避免升级时误删用户已有的快捷方式。
  StrCpy $DesktopShortcutState "1"
!macroend

!macro customPageAfterChangeDir
  Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
!macroend

; 卸载器构建（BUILD_UNINSTALLER）不插入此页，未引用的函数会触发
; “function not referenced” 警告（-WX 下为错误），因此仅在安装器里定义。
!ifndef BUILD_UNINSTALLER

Function DesktopShortcutPageCreate
  ; 静默安装不打扰用户
  ${If} ${Silent}
    Abort
  ${EndIf}
  ; 覆盖升级不弹此页。
  ; 注意：这里不能用 ${isUpdated}——electron-builder 生成的脚本中，自定义 include
  ; 排在 !addplugindir 之前，而 isUpdated 依赖 StdUtils 插件，会编译失败；
  ; 同时 ${INSTALL_REGISTRY_KEY} 也要等 multiUser.nsh 才定义，这里直接用 APP_GUID 拼键路径。
  ReadRegStr $0 HKCU "Software\${APP_GUID}" InstallLocation
  ${If} $0 == ""
    ReadRegStr $0 HKLM "Software\${APP_GUID}" InstallLocation
  ${EndIf}
  ${If} $0 != ""
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ; 自定义 include 在 MUI2 之前被处理，不能用 MUI_HEADER_TEXT；
  ; 这里直接改 MUI 头部控件的文本（1037 标题 / 1038 描述），否则会残留上一页文案。
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 0x000C 0 "STR:选择附加任务"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 0x000C 0 "STR:请选择安装时要执行的附加任务。"

  ${NSD_CreateLabel} 0 0 100% 30u "勾选后会在桌面创建 AtoZ 快捷方式；开始菜单快捷方式始终创建。"
  Pop $0
  ${NSD_CreateCheckbox} 0 38u 100% 12u "创建桌面快捷方式"
  Pop $DesktopShortcutCheckbox
  ${If} $DesktopShortcutState == "1"
    ${NSD_Check} $DesktopShortcutCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function DesktopShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $0
  StrCpy $DesktopShortcutState $0
FunctionEnd

!endif ; BUILD_UNINSTALLER

!macro customInstall
  ; electron-builder 会先按 createDesktopShortcut 建好快捷方式，
  ; 这里按用户在上面页面的选择决定是否撤销（默认勾选，保持原行为）。
  ${If} $DesktopShortcutState == "0"
    Delete "$newDesktopLink"
    System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  ${EndIf}
!macroend
