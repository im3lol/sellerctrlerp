import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding:  { type: "spki",  format: "pem" },
});

console.log("Add to owner .env:");
console.log(`LICENSE_SIGN_PRIVATE_KEY="${privateKey.replace(/\n/g, "\\n")}"`);
console.log("");
console.log("Replace LICENSE_VERIFY_PUBKEY constant in lib/erp/remote-license.ts:");
console.log(publicKey);
