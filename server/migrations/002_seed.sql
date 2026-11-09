-- 기본 권한 · 역할 · 정책 · 어댑터 등록부

INSERT INTO permissions(code, description) VALUES
 ('site.read','현장·함체 조회'),
 ('site.write','현장·함체 등록·수정'),
 ('device.read','장치 상태 조회'),
 ('device.write','장치 등록·설정 변경'),
 ('device.control.power','장비 전원 제어'),
 ('device.control.alarm','경보 출력 제어'),
 ('command.approve','위험 명령 승인'),
 ('alarm.read','장애 조회'),
 ('alarm.ack','장애 확인'),
 ('alarm.manage','장애 담당 지정·조치'),
 ('audit.read','감사로그 조회'),
 ('user.manage','사용자 관리'),
 ('org.manage','기관 관리');

INSERT INTO roles(code, name, rank, requires_mfa) VALUES
 ('central_admin','중앙 관리자',1,true),
 ('org_admin','기관 관리자',2,true),
 ('center_admin','관제센터 관리자',3,true),
 ('operator','관제요원',4,false),
 ('operator_power','관제요원(전원제어)',4,false),
 ('maint_manager','유지보수 관리자',5,false),
 ('field_worker','현장 작업자',6,false),
 ('auditor','감사·조회 사용자',7,false);

INSERT INTO role_permissions(role_id, permission_code)
SELECT r.id, p.code FROM roles r, permissions p
WHERE (r.code = 'central_admin')
   OR (r.code = 'org_admin' AND p.code <> 'org.manage')
   OR (r.code = 'center_admin' AND p.code IN ('site.read','site.write','device.read','device.write','device.control.power','device.control.alarm','command.approve','alarm.read','alarm.ack','alarm.manage','audit.read','user.manage'))
   OR (r.code = 'operator' AND p.code IN ('site.read','device.read','alarm.read','alarm.ack'))
   OR (r.code = 'operator_power' AND p.code IN ('site.read','device.read','alarm.read','alarm.ack','device.control.power','device.control.alarm'))
   OR (r.code = 'maint_manager' AND p.code IN ('site.read','device.read','alarm.read','alarm.ack','alarm.manage'))
   OR (r.code = 'field_worker' AND p.code IN ('site.read','device.read','alarm.read'))
   OR (r.code = 'auditor' AND p.code IN ('site.read','device.read','alarm.read','audit.read'));

-- 설계서 기본값: 30초 감시, 5회 연속 실패, OFF 10초, 부팅 대기 3분, 시간당 3회
INSERT INTO recovery_policies(org_id, name, interval_s, fail_threshold, off_sec, boot_wait_s, max_per_hour, allow_shared_auto)
VALUES (NULL, '기본 자동복구 정책', 30, 5, 10, 180, 3, false);

INSERT INTO alarm_rules(org_id, key, name, condition, severity) VALUES
 (NULL,'device_offline','스마트박스 통신 두절','{"kind":"offline"}','major'),
 (NULL,'input.ups_ac_fail','상용전원 정전','{"kind":"input","input":"ups_ac_fail"}','critical'),
 (NULL,'input.elb_trip','누전차단기 트립','{"kind":"input","input":"elb_trip"}','critical'),
 (NULL,'input.ups_batt_low','UPS 배터리 저전압','{"kind":"input","input":"ups_batt_low"}','major'),
 (NULL,'input.spd_fault','SPD 이상','{"kind":"input","input":"spd_fault"}','major'),
 (NULL,'input.door','함체 문 열림','{"kind":"input","input":"door"}','warning'),
 (NULL,'input.tamper','함체 탬퍼','{"kind":"input","input":"tamper"}','warning'),
 (NULL,'input.di7','예비 입력 1','{"kind":"input","input":"di7"}','info'),
 (NULL,'input.di8','예비 입력 2','{"kind":"input","input":"di8"}','info'),
 (NULL,'shock','함체 충격','{"kind":"event","type":"shock"}','warning'),
 (NULL,'tilt','함체 기울어짐','{"kind":"event","type":"tilt"}','warning'),
 (NULL,'env.overtemp','함체 고온','{"kind":"env","field":"t","op":">=","value":55}','warning'),
 (NULL,'env.undertemp','함체 저온','{"kind":"env","field":"t","op":"<=","value":-15}','warning'),
 (NULL,'env.humidity','함체 고습','{"kind":"env","field":"rh","op":">=","value":90}','warning'),
 (NULL,'sensor_fault','센서 이상','{"kind":"event","type":"sensor_fault"}','warning'),
 (NULL,'recovery','자동복구 실행','{"kind":"event","type":"recovery"}','warning'),
 (NULL,'command_failed','원격 명령 실패','{"kind":"command"}','major');

-- VMS 어댑터 등록부: 실제 구현·검증 상태만 기록한다(2단계에서 갱신)
INSERT INTO vms_adapters(code, name, vendor, adapter_version, supported_levels, verification, notes) VALUES
 ('hanwha_wave','Wisenet WAVE','Hanwha Vision','0.0.0','{}','unverified','2단계 개발 예정. Generic Event(HTTP) 연동 우선'),
 ('nx_witness','Nx Witness','Network Optix','0.0.0','{}','unverified','2단계 개발 예정'),
 ('milestone_xprotect','XProtect','Milestone','0.0.0','{}','unverified','SDK/API 접근권한 필요'),
 ('genetec_sc','Security Center','Genetec','0.0.0','{}','unverified','SDK 접근권한 필요'),
 ('hikcentral','HikCentral Professional','Hikvision','0.0.0','{}','unverified','Generic Event / OpenAPI'),
 ('innodep_vurix','VURIX','Innodep','0.0.0','{}','unsupported','연동 규격 미공개 — 제조사 협의 필요'),
 ('onvif','ONVIF 장비','ONVIF','0.0.0','{}','unverified','Profile S/T/G/M 장비별 확인');

INSERT INTO system_settings(key, value) VALUES
 ('branding','{"productName":"EUM SMART VMS PRO","productNameKo":"이음 스마트 통합관제","companyName":"","logoUrl":""}'),
 ('retention','{"telemetry_days":400,"device_events_days":1095,"audit_days":null}');
