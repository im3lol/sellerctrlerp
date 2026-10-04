/**
 * Writes the English dictionary (lib/i18n/en.ts) as JSON into the native Android app's
 * assets, so the app translates with the very same entries as the web — exact strings and
 * the slotted ones ("الصنف {0} غير موجود"). Run after changing en.ts:
 *   npm run i18n:mobile
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { EN } from "@/lib/i18n/en";

const out = "mobile-app/app/src/main/assets/i18n/en.json";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(EN));
console.log(`${Object.keys(EN).length} entries → ${out}`);
