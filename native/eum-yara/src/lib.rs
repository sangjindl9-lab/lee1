//! EUM SECURITY PRO — YARA-X JNI 연결 모듈 (libeumyara.so).
//! Kotlin 쪽 kr.eumsoft.securitypro.engine.NativeCore 와 1:1 대응한다.

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::{jint, jlong, jstring};
use jni::JNIEnv;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::Duration;

/// 규칙 소스를 컴파일한다. 실패하면 오류 메시지를 돌려준다.
pub fn compile(src: &str) -> Result<yara_x::Rules, String> {
    let mut c = yara_x::Compiler::new();
    c.add_source(src).map_err(|e| e.to_string())?;
    Ok(c.build())
}

/// 데이터를 검사해 일치한 규칙을 JSON 배열로 돌려준다.
pub fn scan(rules: &yara_x::Rules, data: &[u8], timeout_secs: u64) -> Result<String, String> {
    let mut s = yara_x::Scanner::new(rules);
    if timeout_secs > 0 {
        s.set_timeout(Duration::from_secs(timeout_secs));
    }
    let res = s.scan(data).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in res.matching_rules() {
        let mut meta = serde_json::Map::new();
        for (k, v) in r.metadata() {
            let jv = match v {
                yara_x::MetaValue::Integer(i) => serde_json::json!(i),
                yara_x::MetaValue::Float(f) => serde_json::json!(f),
                yara_x::MetaValue::Bool(b) => serde_json::json!(b),
                yara_x::MetaValue::String(s) => serde_json::json!(s),
                yara_x::MetaValue::Bytes(b) => serde_json::json!(String::from_utf8_lossy(b.as_ref())),
            };
            meta.insert(k.to_string(), jv);
        }
        let tags: Vec<String> = r.tags().map(|t| t.identifier().to_string()).collect();
        out.push(serde_json::json!({
            "rule": r.identifier(),
            "namespace": r.namespace(),
            "tags": tags,
            "meta": meta,
        }));
    }
    Ok(serde_json::Value::Array(out).to_string())
}

fn throw(env: &mut JNIEnv, msg: &str) {
    let _ = env.throw_new("java/lang/IllegalStateException", msg);
}

#[no_mangle]
pub extern "system" fn Java_kr_eumsoft_securitypro_engine_NativeCore_nativeVersion(
    env: JNIEnv,
    _c: JClass,
) -> jstring {
    env.new_string("yara-x 1.24.0")
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_kr_eumsoft_securitypro_engine_NativeCore_nativeCompile(
    mut env: JNIEnv,
    _c: JClass,
    src: JString,
) -> jlong {
    let src: String = match env.get_string(&src) {
        Ok(s) => s.into(),
        Err(e) => {
            throw(&mut env, &e.to_string());
            return 0;
        }
    };
    match catch_unwind(AssertUnwindSafe(|| compile(&src))) {
        Ok(Ok(rules)) => Box::into_raw(Box::new(rules)) as jlong,
        Ok(Err(msg)) => {
            throw(&mut env, &format!("YARA 규칙 컴파일 실패: {msg}"));
            0
        }
        Err(_) => {
            throw(&mut env, "YARA 규칙 컴파일 중 내부 오류");
            0
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_kr_eumsoft_securitypro_engine_NativeCore_nativeScan(
    mut env: JNIEnv,
    _c: JClass,
    handle: jlong,
    data: JByteArray,
    timeout_secs: jint,
) -> jstring {
    if handle == 0 {
        throw(&mut env, "규칙이 없습니다");
        return std::ptr::null_mut();
    }
    let bytes = match env.convert_byte_array(&data) {
        Ok(b) => b,
        Err(e) => {
            throw(&mut env, &e.to_string());
            return std::ptr::null_mut();
        }
    };
    let rules = unsafe { &*(handle as *const yara_x::Rules) };
    let r = catch_unwind(AssertUnwindSafe(|| scan(rules, &bytes, timeout_secs.max(0) as u64)));
    match r {
        Ok(Ok(json)) => env
            .new_string(json)
            .map(|s| s.into_raw())
            .unwrap_or(std::ptr::null_mut()),
        Ok(Err(msg)) => {
            throw(&mut env, &format!("YARA 검사 실패: {msg}"));
            std::ptr::null_mut()
        }
        Err(_) => {
            throw(&mut env, "YARA 검사 중 내부 오류");
            std::ptr::null_mut()
        }
    }
}

#[no_mangle]
pub extern "system" fn Java_kr_eumsoft_securitypro_engine_NativeCore_nativeFree(
    _env: JNIEnv,
    _c: JClass,
    handle: jlong,
) {
    if handle != 0 {
        unsafe { drop(Box::from_raw(handle as *mut yara_x::Rules)) };
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    const RULE: &str = r#"
rule EUM_Test_Marker : test {
  meta:
    severity = "high"
    confidence = 90
  strings:
    $a = "EUM-YARA-TEST-MARKER"
  condition:
    $a
}
"#;

    #[test]
    fn matches_marker() {
        let r = compile(RULE).unwrap();
        let j = scan(&r, b"xx EUM-YARA-TEST-MARKER yy", 5).unwrap();
        assert!(j.contains("EUM_Test_Marker"), "{j}");
        assert!(j.contains("\"severity\":\"high\""), "{j}");
        assert!(j.contains("\"test\""), "{j}");
    }

    #[test]
    fn no_match() {
        let r = compile(RULE).unwrap();
        assert_eq!(scan(&r, b"normal file content", 5).unwrap(), "[]");
    }

    /// 앱에 실제로 들어가는 규칙(db_src/yara)이 컴파일되고, 무해한 테스트 픽스처만 탐지하는지 확인
    #[test]
    fn shipped_rules_compile_and_match_fixture() {
        let src = [include_str!("../../../db_src/yara/eum_test.yar"), include_str!("../../../db_src/yara/eum_heuristics.yar")].join("\n\n");
        let r = compile(&src).expect("shipped rules compile");
        let mut dex = b"dex\n035\0".to_vec();
        dex.resize(0x70, 0);
        dex.extend_from_slice(b"EUM-SECURITY-TEST-MALWARE-MARKER-0001");
        let j = scan(&r, &dex, 5).unwrap();
        assert!(j.contains("EUM_TEST_Marker"), "{j}");
        assert!(!j.contains("EUM_HEUR"), "{j}");
        assert_eq!(scan(&r, b"plain text with dispatchGesture only", 5).unwrap(), "[]");
    }

    #[test]
    fn bad_rule_reports_error() {
        assert!(compile("rule x { condition: nope }").is_err());
    }

    #[test]
    fn dex_module_available() {
        let r = compile("import \"dex\"\nrule d { condition: dex.is_dex }").unwrap();
        let mut dex = b"dex\n035\0".to_vec();
        dex.resize(0x70, 0);
        // 헤더가 불완전한 파일은 dex 로 인식되지 않아야 한다(크래시 없이).
        let _ = scan(&r, &dex, 5).unwrap();
    }
}
