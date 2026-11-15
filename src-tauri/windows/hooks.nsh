; LifeLog's additions to Tauri's installer (tauri.conf.json, installerHooks).
;
; Uninstalling with "Delete the application data" ticked: Tauri removes the
; AppData folders itself; this removes the data folder Settings → Desktop
; chose (src-tauri/src/datafolder.rs writes it to the registry), and the
; copy left behind by the last move. Only LifeLog's own EBWebView folders go:
; a custom folder may be one the person uses for other things. An update
; runs the uninstaller too, so nothing here happens then.

!macro LIFELOG_REMOVE_DATA DIR
  ${If} ${DIR} != ""
    RMDir /r "${DIR}\EBWebView"
    RMDir /r "${DIR}\EBWebView-old"
    RMDir /r "${DIR}\EBWebView-moving"
    RMDir "${DIR}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    ReadRegStr $R0 HKCU "Software\LifeLog" "DataFolder"
    !insertmacro LIFELOG_REMOVE_DATA $R0
    ReadRegStr $R0 HKCU "Software\LifeLog" "DataFolderOld"
    !insertmacro LIFELOG_REMOVE_DATA $R0
    !insertmacro LIFELOG_REMOVE_DATA "$INSTDIR\data"
    DeleteRegKey HKCU "Software\LifeLog"
    RMDir "$INSTDIR"
  ${EndIf}
!macroend
