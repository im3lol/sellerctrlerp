/**
 * Pure TypeScript CODE128B encoder → SVG string.
 * No dependencies. Works server-side and in the browser.
 *
 * Code128B encodes ASCII 32-126. Every item code/barcode value should
 * be within this range. Non-encodable characters are silently stripped.
 */

// Symbol patterns (6 elements each, alternating bar/space starting with bar)
// Indices 0-102: data symbols.  103=StartA  104=StartB  105=StartC  106=Stop(7 elem)
const SYM: readonly string[] = [
  "212222","222122","222221","121223","121322","131222","122213","122312",
  "132212","221213","221312","231212","112232","122132","122231","113222",
  "123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321",
  "232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321",
  "331121","312113","312311","332111","314111","221411","431111","111224",
  "111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112",
  "421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131",
  "211412","211214","211232", // 103=StartA, 104=StartB, 105=StartC
];
const STOP_PAT = "2331112"; // 7-element stop symbol
const START_B  = 104;

function toModules(text: string): number[] {
  const data: number[] = [];
  for (const ch of text) {
    const v = ch.charCodeAt(0) - 32;
    if (v >= 0 && v <= 94) data.push(v);
  }
  if (data.length === 0) return [];

  // checksum
  let check = START_B;
  for (let i = 0; i < data.length; i++) check += (i + 1) * data[i];
  check %= 103;

  // Build bar sequence: positive = black, negative = white (in modules)
  const bars: number[] = [-10]; // left quiet zone

  const addPat = (pat: string) => {
    let dark = true;
    for (const ch of pat) {
      const w = parseInt(ch);
      bars.push(dark ? w : -w);
      dark = !dark;
    }
  };

  addPat(SYM[START_B]!);
  for (const v of data) addPat(SYM[v]!);
  addPat(SYM[check]!);
  addPat(STOP_PAT);

  bars.push(-10); // right quiet zone
  return bars;
}

/**
 * Generate a CODE128B barcode as an inline SVG string.
 *
 * @param text       The value to encode (ASCII 32-126; other chars stripped)
 * @param barHeight  Bar height in SVG user units (default 32)
 * @param showText   Render the human-readable text below the bars (default true)
 * @returns SVG markup string, empty string if text encodes to nothing
 */
export function code128Svg(text: string, barHeight = 32, showText = true): string {
  const clean = text.replace(/[^\x20-\x7E]/g, ""); // strip non-Code128B chars
  const bars = toModules(clean);
  if (bars.length === 0) return "";

  const totalModules = bars.reduce((s, b) => s + Math.abs(b), 0);

  // Build rect elements (black bars only)
  let rects = "";
  let x = 0;
  for (const b of bars) {
    const w = Math.abs(b);
    if (b > 0) rects += `<rect x="${x}" y="0" width="${w}" height="${barHeight}"/>`;
    x += w;
  }

  const svgH = barHeight + (showText ? 10 : 0);
  const textEl = showText
    ? `<text x="${totalModules / 2}" y="${barHeight + 8}" text-anchor="middle" font-family="monospace" font-size="7" fill="black">${clean}</text>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${totalModules} ${svgH}" ` +
    `width="100%" preserveAspectRatio="none" ` +
    `style="display:block;height:${barHeight + (showText ? 10 : 0)}px">` +
    `<rect width="${totalModules}" height="${svgH}" fill="white"/>` +
    `<g fill="black">${rects}</g>${textEl}` +
    `</svg>`
  );
}
