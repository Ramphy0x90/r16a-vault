//! Independent check of `shared/crypto-test-vectors.json`.
//!
//! The vectors are produced with libsodium. This tool recomputes them with RustCrypto
//! implementations of Argon2id, BLAKE2b and XChaCha20-Poly1305, so a mistake in how the
//! generator drives libsodium cannot silently become the reference both clients test
//! against. TOTP vectors are already pinned to RFC 6238 by the generator.

use std::{fs, process::ExitCode};

use argon2::{Algorithm, Argon2, Params, Version};
use blake2::{Blake2bMac, digest::Mac};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
    consts::U32,
};
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

fn h(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().expect("hex string")).expect("valid hex")
}

fn s(v: &Value) -> &str {
    v.as_str().expect("string")
}

/// Mirrors libsodium `crypto_kdf_derive_from_key`, which is keyed BLAKE2b with the subkey
/// id as a little endian salt and the context as the personalisation, both zero padded.
fn kdf(master: &[u8], id: u64, ctx: &str) -> Vec<u8> {
    let mut salt = [0u8; 16];
    salt[..8].copy_from_slice(&id.to_le_bytes());
    let mut persona = [0u8; 16];
    persona[..8].copy_from_slice(ctx.as_bytes());
    let mac = Blake2bMac::<U32>::new_with_salt_and_personal(Some(master), &salt, &persona).expect("valid lengths");
    mac.finalize().into_bytes().to_vec()
}

fn argon(password: &str, salt: &[u8], ops: u32, mem: u64) -> Vec<u8> {
    let params = Params::new(u32::try_from(mem / 1024).expect("fits"), ops, 1, Some(32)).expect("params");
    let mut out = vec![0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.nfc().collect::<String>().as_bytes(), salt, &mut out)
        .expect("argon2");
    out
}

fn seal(key: &[u8], plaintext: &[u8], aad: &str, nonce: &[u8]) -> Vec<u8> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).expect("key length");
    let nonce = XNonce::try_from(nonce).expect("nonce length");
    let ct = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad: aad.as_bytes() })
        .expect("encrypt");
    [vec![0x01], nonce.to_vec(), ct].concat()
}

fn open(key: &[u8], blob: &[u8], aad: &str) -> Option<Vec<u8>> {
    if blob.len() < 41 || blob[0] != 0x01 {
        return None;
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).ok()?;
    let nonce = XNonce::try_from(&blob[1..25]).ok()?;
    cipher.decrypt(&nonce, Payload { msg: &blob[25..], aad: aad.as_bytes() }).ok()
}

fn main() -> ExitCode {
    let path = std::env::args().nth(1).unwrap_or_else(|| String::from("../../crypto-test-vectors.json"));
    let v: Value = serde_json::from_str(&fs::read_to_string(&path).expect("read vectors")).expect("json");
    let mut failures = Vec::new();
    let mut check = |name: &str, ok: bool| {
        println!("{} {name}", if ok { "ok  " } else { "FAIL" });
        if !ok {
            failures.push(name.to_owned());
        }
    };

    for c in v["argon2id"].as_array().expect("array") {
        let name = s(&c["name"]);
        let pw = s(&c["password"]);
        check(&format!("argon2id {name} nfc bytes"), pw.nfc().collect::<String>().as_bytes() == h(&c["passwordNfcUtf8Hex"]));
        let mk = argon(pw, &h(&c["saltHex"]), c["opslimit"].as_u64().expect("ops") as u32, c["memlimit"].as_u64().expect("mem"));
        check(&format!("argon2id {name} master key"), mk == h(&c["masterKeyHex"]));
        check(&format!("argon2id {name} auth key"), kdf(&mk, 1, "r16aauth") == h(&c["authKeyHex"]));
        check(&format!("argon2id {name} wrap key"), kdf(&mk, 2, "r16awrap") == h(&c["wrapKeyHex"]));
    }

    let k = &v["kdf"];
    check("kdf auth key", kdf(&h(&k["masterKeyHex"]), 1, "r16aauth") == h(&k["authKeyHex"]));
    check("kdf wrap key", kdf(&h(&k["masterKeyHex"]), 2, "r16awrap") == h(&k["wrapKeyHex"]));

    let w = &v["wrap"];
    let wrapped = seal(&h(&w["wrapKeyHex"]), &h(&w["vaultKeyHex"]), s(&w["aad"]), &h(&w["nonceHex"]));
    check("wrap blob", wrapped == h(&w["blobHex"]));
    check("wrap opens", open(&h(&w["wrapKeyHex"]), &wrapped, s(&w["aad"])) == Some(h(&w["vaultKeyHex"])));

    let c = &v["credential"];
    let vk = h(&c["vaultKeyHex"]);
    for field in ["meta", "secret"] {
        let f = &c[field];
        let blob = seal(&vk, s(&f["plaintext"]).as_bytes(), s(&f["aad"]), &h(&f["nonceHex"]));
        check(&format!("credential {field} blob"), blob == h(&f["blobHex"]));
        let expected_aad = format!("r16a-vault:cred:v1:{}:{field}", s(&c["credentialId"]));
        check(&format!("credential {field} aad"), s(&f["aad"]) == expected_aad);
    }

    let n = &v["negative"];
    for case in n["cases"].as_array().expect("array") {
        let rejected = open(&h(&n["vaultKeyHex"]), &h(&case["blobHex"]), s(&case["aad"])).is_none();
        check(&format!("negative {} rejected", s(&case["name"])), rejected);
    }

    if failures.is_empty() {
        println!("all vectors verified independently");
        ExitCode::SUCCESS
    } else {
        eprintln!("{} vector checks failed", failures.len());
        ExitCode::FAILURE
    }
}
