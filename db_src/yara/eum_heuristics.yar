// EUM 자체 휴리스틱 규칙 v1 — 의심 근거(주의) 용도. 악성 확정 판정에 쓰지 않는다 (confidence ≤ 50).
import "dex"

rule EUM_HEUR_Accessibility_Overlay_SMS_Banker
{
    meta:
        severity = "MEDIUM"
        confidence = 45
        description = "접근성 제스처 제어 + 화면 덮기 + 문자 발송 코드가 한 DEX 에 함께 있음 (금융 트로이목마에서 흔한 조합)"
    strings:
        $a1 = "dispatchGesture"
        $a2 = "performGlobalAction"
        $a3 = "getRootInActiveWindow"
        $o1 = "TYPE_APPLICATION_OVERLAY"
        $s1 = "sendTextMessage"
        $s2 = "getMessageBody"
    condition:
        dex.is_dex and 2 of ($a*) and $o1 and all of ($s*)
}

rule EUM_HEUR_Root_Exploit_Commands
{
    meta:
        severity = "MEDIUM"
        confidence = 50
        description = "시스템 파티션을 쓰기 가능으로 다시 마운트하고 su 를 설치하는 명령 (루팅 익스플로잇 패턴)"
    strings:
        $r1 = "mount -o remount,rw /system"
        $r2 = "/system/xbin/su"
        $r3 = "chmod 4755"
        $r4 = "chmod 6755"
    condition:
        $r1 and $r2 and 1 of ($r3, $r4)
}

rule EUM_HEUR_Hide_Icon_Device_Admin_Lock
{
    meta:
        severity = "MEDIUM"
        confidence = 40
        description = "런처 아이콘 숨김 + 기기 관리자 권한으로 화면 잠금/비밀번호 변경 (랜섬웨어·스파이앱 패턴)"
    strings:
        $h1 = "setComponentEnabledSetting"
        $d1 = "resetPassword"
        $d2 = "lockNow"
        $d3 = "ACTION_ADD_DEVICE_ADMIN"
    condition:
        dex.is_dex and $h1 and $d3 and 1 of ($d1, $d2)
}
