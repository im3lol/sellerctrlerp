#!/usr/bin/env node
/**
 * Generate a SellerCtrl Desktop license token.
 *
 * Usage: node scripts/gen-desktop-license.cjs
 *
 * After generating:
 * 1. Copy the token_hash + token_hint into the database:
 *    INSERT INTO desktop_licenses (token_hash, token_hint, organization_id, enabled_modules, notes)
 *    VALUES ('<hash>', '<hint>', '<org_uuid>', '["accounting","inventory","sales","purchases"]', 'Customer name');
 *
 * 2. Send the raw token to the customer — it is NOT stored anywhere, only the hash is kept.
 */

const { randomBytes, createHmac } = require("node:crypto");

const SECRET = process.env.DESKTOP_LICENSE_SECRET ?? "SC_DL_DEFAULT_SECRET_CHANGE_IN_ENV";

const raw = randomBytes(24).toString("base64url").toUpperCase().slice(0, 32);
const formatted = raw.match(/.{1,8}/g).join("-");
const hash = createHmac("sha256", SECRET).update(raw).digest("hex");
const hint = `...${raw.slice(-6)}`;

console.log("\n=== SellerCtrl Desktop License Token ===\n");
console.log("TOKEN (share with customer, NOT stored):");
console.log(" ", formatted);
console.log("\nInsert into DB:");
console.log(`  token_hash: ${hash}`);
console.log(`  token_hint: ${hint}`);
console.log("\nCustomer enters: SERVER_URL + TOKEN in the activation screen.\n");
