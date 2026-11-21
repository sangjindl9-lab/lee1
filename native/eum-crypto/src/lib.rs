//! EUM SECURITY PRO — 위협 DB 서명 검증 (libeumcrypto.so). 모든 ABI 에서 빌드된다.
use jni::objects::{JByteArray, JClass};
use jni::JNIEnv;

/// Ed25519 서명 검증 (위협 DB 업데이트 무결성).
pub fn verify_ed25519(public_key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    use ed25519_dalek::{Signature, VerifyingKey};
    let Ok(pk) = <[u8; 32]>::try_from(public_key) else { return false };
    let Ok(sg) = <[u8; 64]>::try_from(sig) else { return false };
    let Ok(vk) = VerifyingKey::from_bytes(&pk) else { return false };
    vk.verify_strict(msg, &Signature::from_bytes(&sg)).is_ok()
}

#[no_mangle]
pub extern "system" fn Java_kr_eumsoft_securitypro_engine_NativeCrypto_nativeVerifyEd25519(
    env: JNIEnv,
    _c: JClass,
    public_key: JByteArray,
    msg: JByteArray,
    sig: JByteArray,
) -> jni::sys::jboolean {
    let (Ok(p), Ok(m), Ok(s)) = (
        env.convert_byte_array(&public_key),
        env.convert_byte_array(&msg),
        env.convert_byte_array(&sig),
    ) else {
        return 0;
    };
    verify_ed25519(&p, &m, &s) as jni::sys::jboolean
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ed25519_rejects_tampered() {
        use ed25519_dalek::{Signer, SigningKey};
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk = sk.verifying_key().to_bytes();
        let sig = sk.sign(b"db-v2").to_bytes();
        assert!(verify_ed25519(&pk, b"db-v2", &sig));
        assert!(!verify_ed25519(&pk, b"db-v3", &sig));
        assert!(!verify_ed25519(&pk[..31], b"db-v2", &sig));
    }

}
