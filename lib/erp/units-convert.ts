/**
 * Physical units, converted once on the way in. Pure.
 *
 * Marketplace catalogues answer in whatever the marketplace uses — Amazon US reports a
 * weight in pounds and a box in inches. Storing that verbatim gives an Egyptian trader a
 * number they cannot act on, and, worse, leaves `items.weightKg` empty: that column is
 * what freight-by-weight allocation divides by, so an imported item silently carries no
 * weight at all when import costs are spread.
 *
 * So: parse the supplier's figure, convert to kilograms and centimetres, and keep those.
 * The original string is not worth preserving — it was only ever a label.
 */

/** kg per one unit. */
const TO_KG: Record<string, number> = {
  kg: 1, kgs: 1, kilogram: 1, kilograms: 1, kilo: 1, kilos: 1,
  g: 0.001, gram: 0.001, grams: 0.001, gm: 0.001, gms: 0.001,
  mg: 0.000001, milligram: 0.000001, milligrams: 0.000001,
  lb: 0.45359237, lbs: 0.45359237, pound: 0.45359237, pounds: 0.45359237,
  oz: 0.028349523125, ounce: 0.028349523125, ounces: 0.028349523125,
  ton: 1000, tonne: 1000, tonnes: 1000,
};

/** cm per one unit. */
const TO_CM: Record<string, number> = {
  cm: 1, centimeter: 1, centimeters: 1, centimetre: 1, centimetres: 1,
  mm: 0.1, millimeter: 0.1, millimeters: 0.1, millimetre: 0.1, millimetres: 0.1,
  m: 100, meter: 100, meters: 100, metre: 100, metres: 100,
  in: 2.54, inch: 2.54, inches: 2.54, '"': 2.54,
  ft: 30.48, foot: 30.48, feet: 30.48, "'": 30.48,
};

const norm = (u: string) => u.trim().toLowerCase().replace(/\.$/, "");

/** Weight in kilograms, or null when the unit is not one we know. */
export function toKg(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const f = TO_KG[norm(unit)];
  if (f === undefined) return null;
  // 3dp matches the column (numeric(10,3)); a gram is the smallest thing worth keeping.
  return Math.round(value * f * 1000) / 1000;
}

/** Length in centimetres, or null when the unit is not one we know. */
export function toCm(value: number, unit: string): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const f = TO_CM[norm(unit)];
  if (f === undefined) return null;
  return Math.round(value * f * 100) / 100;
}

/**
 * Read a catalogue's free-text measure — "0.37 pounds", "9.055 inches", "1,2 kg".
 * Returns the number and the raw unit; conversion is the caller's business.
 */
export function parseMeasure(text: string | null | undefined): { value: number; unit: string } | null {
  if (!text) return null;
  const m = text.trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return null;
  // A comma may be a decimal separator or a thousands separator. "1,234" is one thousand
  // two hundred; "1,2" is one point two — decide by what follows it.
  const raw = /,\d{3}(\D|$)/.test(m[1]) ? m[1].replace(/,/g, "") : m[1].replace(",", ".");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].trim();
  return unit ? { value, unit } : null;
}

/** "0.37 pounds" → 0.168 kg. Null when it cannot be read or the unit is unknown. */
export function weightTextToKg(text: string | null | undefined): number | null {
  const p = parseMeasure(text);
  return p ? toKg(p.value, p.unit) : null;
}

/**
 * How a weight should read to an Egyptian trader: grams below a kilo, kilograms above.
 * "0.168 kg" is a number people have to think about; "168 جم" is not.
 */
export function formatWeight(kg: number | null | undefined): string | null {
  if (kg == null || !Number.isFinite(kg) || kg <= 0) return null;
  if (kg < 1) {
    const g = Math.round(kg * 1000);
    return `${g.toLocaleString("ar-EG-u-nu-latn")} جم`;
  }
  return `${(Math.round(kg * 1000) / 1000).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 })} كجم`;
}

/** "2.54 × 5.5 × 23 سم" — one unit for the box, stated once. */
export function formatDimensionsCm(
  l: number | null | undefined, w: number | null | undefined, h: number | null | undefined,
): string | null {
  const parts = [l, w, h].filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
  if (parts.length < 3) return null;
  const n = (v: number) => (Math.round(v * 100) / 100).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 2 });
  return `${n(parts[0])} × ${n(parts[1])} × ${n(parts[2])} سم`;
}

/**
 * Convert a whole dimensions string that carries ONE trailing unit, the shape marketplace
 * catalogues use: "0.039 × 2.165 × 9.055 inches" → "0.1 × 5.5 × 23 سم".
 */
export function dimensionsTextToCm(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.trim().match(/^([\d.,]+)\s*[×x*]\s*([\d.,]+)\s*[×x*]\s*([\d.,]+)\s*(.*)$/i);
  if (!m) return null;
  const unit = m[4].trim();
  if (!unit) return null;
  const nums = [m[1], m[2], m[3]].map((raw) => {
    const p = parseMeasure(`${raw} ${unit}`);
    return p ? toCm(p.value, p.unit) : null;
  });
  return formatDimensionsCm(nums[0], nums[1], nums[2]);
}
