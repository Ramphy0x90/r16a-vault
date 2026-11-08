// Generates shared/crypto-test-vectors.json.
//
// Every value is derived with libsodium, the same library both clients use. The Rust tool in
// shared/tools/vector-verify recomputes vectors with RustCrypto as an independent check, and
// TOTP values are computed with Node's own HMAC and asserted against RFC 6238 Appendix B.
// Inputs are fixed so the output is byte for byte reproducible.

import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sodiumModule from 'libsodium-wrappers-sumo';

const sodium = sodiumModule;
await sodium.ready;

const hex = (u8) => Buffer.from(u8).toString('hex');
const fromHex = (h) => new Uint8Array(Buffer.from(h, 'hex'));
const utf8 = (s) => new TextEncoder().encode(s);
const pattern = (len, start) => Uint8Array.from({ length: len }, (_, i) => (start + i * 7) & 0xff);

const OPSLIMIT = 3;
const MEMLIMIT = 64 * 1024 * 1024;
const VERSION = 0x01;
const VK_AAD = 'r16a-vault:vk:v1';
const credAad = (id, field) => `r16a-vault:cred:v1:${id}:${field}`;

function deriveMaster(password, salt) {
  return sodium.crypto_pwhash(
    32,
    utf8(password.normalize('NFC')),
    salt,
    OPSLIMIT,
    MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function subkeys(masterKey) {
  return {
    authKey: sodium.crypto_kdf_derive_from_key(32, 1, 'r16aauth', masterKey),
    wrapKey: sodium.crypto_kdf_derive_from_key(32, 2, 'r16awrap', masterKey),
  };
}

function seal(key, plaintext, aad, nonce) {
  const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, utf8(aad), null, nonce, key);
  const out = new Uint8Array(1 + nonce.length + ct.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(ct, 1 + nonce.length);
  return out;
}

function open(key, blob, aad) {
  if (blob.length < 41 || blob[0] !== VERSION) throw new Error('bad envelope');
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, blob.subarray(25), utf8(aad), blob.subarray(1, 25), key);
}

// Argon2id cases. The non ASCII password appears in composed and decomposed form and both
// must produce the same master key once the client applies NFC.
const nfc = 'Pässwörd ñoño ☃';
const nfd = 'Pässwörd ñoño ☃';
if (nfc === nfd || nfd.normalize('NFC') !== nfc) throw new Error('normalisation fixture is wrong');

const argonCases = [
  { name: 'ascii', password: 'correct horse battery staple', salt: pattern(16, 1) },
  { name: 'non-ascii-composed', password: nfc, salt: pattern(16, 101) },
  { name: 'non-ascii-decomposed', password: nfd, salt: pattern(16, 101) },
].map((c) => {
  const masterKey = deriveMaster(c.password, c.salt);
  const { authKey, wrapKey } = subkeys(masterKey);
  return {
    name: c.name,
    password: c.password,
    passwordNfcUtf8Hex: hex(utf8(c.password.normalize('NFC'))),
    saltHex: hex(c.salt),
    opslimit: OPSLIMIT,
    memlimit: MEMLIMIT,
    masterKeyHex: hex(masterKey),
    authKeyHex: hex(authKey),
    wrapKeyHex: hex(wrapKey),
  };
});
if (argonCases[1].masterKeyHex !== argonCases[2].masterKeyHex) throw new Error('NFC and NFD must agree');
const unnormalised = sodium.crypto_pwhash(32, utf8(nfd), pattern(16, 101), OPSLIMIT, MEMLIMIT, sodium.crypto_pwhash_ALG_ARGON2ID13);
if (hex(unnormalised) === argonCases[1].masterKeyHex) throw new Error('fixture does not exercise normalisation');

const kdfMaster = pattern(32, 3);
const kdf = { masterKeyHex: hex(kdfMaster), ...Object.fromEntries(Object.entries(subkeys(kdfMaster)).map(([k, v]) => [`${k}Hex`, hex(v)])) };

const wrapKey = pattern(32, 9);
const vaultKey = pattern(32, 200);
const wrapNonce = pattern(24, 50);
const wrapped = seal(wrapKey, vaultKey, VK_AAD, wrapNonce);

const credentialId = '0192f6c8-4b2a-4e7d-9a51-3c9e1d7b2a10';
const metaJson = JSON.stringify({ name: 'Example Mail', url: 'https://mail.example.com', username: 'alice@example.com' });
const secretJson = JSON.stringify({ password: 'S3crét \u{1F511} pass', mfaSecret: 'JBSWY3DPEHPK3PXP' });
const metaNonce = pattern(24, 70);
const secretNonce = pattern(24, 90);
const metaBlob = seal(vaultKey, utf8(metaJson), credAad(credentialId, 'meta'), metaNonce);
const secretBlob = seal(vaultKey, utf8(secretJson), credAad(credentialId, 'secret'), secretNonce);

const wrongVersion = metaBlob.slice();
wrongVersion[0] = 0x02;
const negative = [
  { name: 'meta-blob-with-secret-aad', blobHex: hex(metaBlob), aad: credAad(credentialId, 'secret') },
  { name: 'meta-blob-under-other-row', blobHex: hex(metaBlob), aad: credAad('00000000-0000-4000-8000-000000000000', 'meta') },
  { name: 'wrong-version-byte', blobHex: hex(wrongVersion), aad: credAad(credentialId, 'meta') },
  { name: 'truncated', blobHex: hex(metaBlob.subarray(0, 40)), aad: credAad(credentialId, 'meta') },
  { name: 'flipped-tag-bit', blobHex: hex(Uint8Array.from(metaBlob, (b, i) => (i === metaBlob.length - 1 ? b ^ 1 : b))), aad: credAad(credentialId, 'meta') },
];
for (const n of negative) {
  let opened = true;
  try {
    open(vaultKey, fromHex(n.blobHex), n.aad);
  } catch {
    opened = false;
  }
  if (opened) throw new Error(`negative case ${n.name} unexpectedly opened`);
}
if (new TextDecoder().decode(open(vaultKey, metaBlob, credAad(credentialId, 'meta'))) !== metaJson) throw new Error('roundtrip failed');

// TOTP per RFC 6238 with a plain HMAC implementation, independent of any OTP library.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function totp(secret, algorithm, digits, period, time) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / period)));
  const mac = createHmac(algorithm.toLowerCase(), Buffer.from(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

const rfcSecrets = {
  SHA1: utf8('12345678901234567890'),
  SHA256: utf8('12345678901234567890123456789012'),
  SHA512: utf8('1234567890123456789012345678901234567890123456789012345678901234'),
};
const rfcExpected = {
  59: { SHA1: '94287082', SHA256: '46119246', SHA512: '90693936' },
  1111111109: { SHA1: '07081804', SHA256: '68084774', SHA512: '25091201' },
  1111111111: { SHA1: '14050471', SHA256: '67062674', SHA512: '99943326' },
  1234567890: { SHA1: '89005924', SHA256: '91819424', SHA512: '93441116' },
  2000000000: { SHA1: '69279037', SHA256: '90698825', SHA512: '38618901' },
  20000000000: { SHA1: '65353130', SHA256: '77737706', SHA512: '47863826' },
};
const totpCases = [];
for (const [time, byAlg] of Object.entries(rfcExpected)) {
  for (const [alg, expected] of Object.entries(byAlg)) {
    const got = totp(rfcSecrets[alg], alg, 8, 30, Number(time));
    if (got !== expected) throw new Error(`RFC 6238 mismatch ${alg} ${time}`);
    totpCases.push({ name: `rfc6238-${alg.toLowerCase()}-${time}`, secret: base32(rfcSecrets[alg]), algorithm: alg, digits: 8, period: 30, time: Number(time), code: expected });
  }
}
const sha1b32 = base32(rfcSecrets.SHA1);
const spaced = sha1b32.toLowerCase().replace(/(.{4})/g, '$1 ').trim();
totpCases.push({ name: 'default-params-normalised-input', secret: spaced, algorithm: 'SHA1', digits: 6, period: 30, time: 59, code: totp(rfcSecrets.SHA1, 'SHA1', 6, 30, 59) });
totpCases.push({ name: 'default-params-padded', secret: `${sha1b32}====`, algorithm: 'SHA1', digits: 6, period: 30, time: 1111111109, code: totp(rfcSecrets.SHA1, 'SHA1', 6, 30, 1111111109) });
const uriSecret = base32(rfcSecrets.SHA256);
totpCases.push({
  name: 'otpauth-uri-sha256-8-digits-60s',
  secret: `otpauth://totp/Example%20Co:alice%40example.com?secret=${uriSecret}&issuer=Example%20Co&algorithm=SHA256&digits=8&period=60`,
  algorithm: 'SHA256',
  digits: 8,
  period: 60,
  time: 1234567890,
  code: totp(rfcSecrets.SHA256, 'SHA256', 8, 60, 1234567890),
});

const vectors = {
  description: 'Fixed inputs and expected outputs for the r16a-vault client crypto protocol (docs/SPEC.md section 3). Generated by shared/scripts/generate-vectors.mjs, verified independently by shared/tools/vector-verify. Do not edit by hand.',
  version: 1,
  libsodiumVersion: sodium.SODIUM_VERSION_STRING,
  constants: {
    blobVersion: VERSION,
    nonceBytes: 24,
    tagBytes: 16,
    vaultKeyAad: VK_AAD,
    credentialAadTemplate: 'r16a-vault:cred:v1:{credentialId}:{field}',
    authContext: 'r16aauth',
    authSubkeyId: 1,
    wrapContext: 'r16awrap',
    wrapSubkeyId: 2,
  },
  argon2id: argonCases,
  kdf,
  wrap: { wrapKeyHex: hex(wrapKey), vaultKeyHex: hex(vaultKey), nonceHex: hex(wrapNonce), aad: VK_AAD, blobHex: hex(wrapped) },
  credential: {
    vaultKeyHex: hex(vaultKey),
    credentialId,
    meta: { plaintext: metaJson, aad: credAad(credentialId, 'meta'), nonceHex: hex(metaNonce), blobHex: hex(metaBlob) },
    secret: { plaintext: secretJson, aad: credAad(credentialId, 'secret'), nonceHex: hex(secretNonce), blobHex: hex(secretBlob) },
  },
  negative: { vaultKeyHex: hex(vaultKey), cases: negative },
  totp: totpCases,
};

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'crypto-test-vectors.json');
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`wrote ${out}`);
