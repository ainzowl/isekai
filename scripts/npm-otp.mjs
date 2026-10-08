#!/usr/bin/env node
// Prints the current TOTP code for `npm publish`.
// npm requires a TOTP code for CLI publishing; passkeys and email OTPs are
// website-only. Save your npm 2FA secret once (shown when you add an
// "Authenticator app" at https://www.npmjs.com/settings/ainzoal/tfa):
//
//   echo "YOUR_BASE32_SECRET" > .npm-totp   (gitignored)
//   # or: export NPM_TOTP_SECRET=YOUR_BASE32_SECRET
//
// Usage: node scripts/npm-otp.mjs             -> 123456  (28s left)
//        node scripts/npm-otp.mjs --self-test
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input) {
  const clean = String(input).replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("invalid base32 character: " + char);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

function totp(secret, atMs, digits) {
  const counter = Math.floor(atMs / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const digest = createHmac("sha1", decodeBase32(secret)).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") {
  // RFC 6238 test key; at time 59s the 8-digit code must be 94287082.
  const code = totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59 * 1000, 8);
  console.log(code === "94287082" ? "self-test ok" : "self-test FAILED: " + code);
  process.exit(code === "94287082" ? 0 : 1);
}

let secret = process.env.NPM_TOTP_SECRET;
if (!secret) {
  for (const file of [".npm-totp", ".npm-totp-secret"]) {
    try {
      secret = readFileSync(file, "utf8").trim();
      break;
    } catch (err) {
      /* try the next location */
    }
  }
}
if (!secret) {
  console.error("No TOTP secret found. Put it in ./.npm-totp (gitignored) or export NPM_TOTP_SECRET. See this file's header.");
  process.exit(1);
}

const now = Date.now();
console.log(totp(secret, now, 6) + "  (" + (30 - Math.floor((now / 1000) % 30)) + "s left)");
