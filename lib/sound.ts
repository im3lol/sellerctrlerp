"use client";

// Distinct UI chimes synthesized live with the Web Audio API — no audio files, no
// dependencies, no copying anyone's copyrighted sound. Short, bright and pleasant
// (Shopify "cha-ching" spirit). Three kinds: confirm / notify / delete.

let ctx: AudioContext | null = null;
let master: DynamicsCompressorNode | null = null; // limiter so loud, overlapping notes don't clip harshly
function audio(): { ac: AudioContext; out: AudioNode } | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // A brick-wall limiter that ONLY catches peaks near 0dBFS — it must not squash
    // the whole signal (an earlier -6dB threshold made everything quieter, not safer).
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -1; master.knee.value = 0; master.ratio.value = 20;
    master.attack.value = 0.002; master.release.value = 0.12;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return { ac: ctx, out: master! };
}

export type Chime = "confirm" | "notify" | "delete";

// Notes per chime: [frequency Hz, start offset s, duration s].
const NOTES: Record<Chime, [number, number, number][]> = {
  confirm: [[660, 0, 0.18], [880, 0.11, 0.32]],                                          // rising third — positive
  // Shopify-style "cha-ching": two bright bell strikes, each layered with a fifth +
  // octave partial for a metallic register-bell ring; the second rings out longer.
  notify: [
    [1319, 0.0, 0.28], [1976, 0.0, 0.2], [2637, 0.0, 0.14],   // ding
    [1760, 0.13, 0.6], [2637, 0.13, 0.4], [3520, 0.13, 0.24], // DING (rings out)
  ],
  delete:  [[520, 0, 0.18], [392, 0.14, 0.34]],                                          // gentle descent — remove/cancel
};

// Timbre per chime — triangle reads brighter/louder for the notification.
const WAVE: Record<Chime, OscillatorType> = { confirm: "sine", notify: "triangle", delete: "sine" };

const PEAK = 0.95; // ~3x the earlier 0.32; the master limiter keeps it from clipping harshly

const KEY = "sc_sound";
export function isSoundOn(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(KEY) !== "off";
}
export function setSoundOn(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch {}
  if (on) playChime("notify"); // preview the new-order chime when (re)enabling
}

// Chimes with a real audio file at /public/sounds/<kind>.mp3. Add a kind here once
// its file is in place; anything not listed falls back to the synth below.
const FILE_CHIMES = new Set<Chime>(["notify"]);

export function playChime(kind: Chime): void {
  if (!isSoundOn()) return;
  if (FILE_CHIMES.has(kind)) {
    try {
      const el = new Audio(`/sounds/${kind}.mp3`);
      el.volume = 1;
      el.play().catch(() => synth(kind)); // autoplay blocked / missing → synth
      return;
    } catch { /* fall through to synth */ }
  }
  synth(kind);
}

/** Fallback: synthesize the chime with the Web Audio API (no asset file needed). */
function synth(kind: Chime): void {
  const a = audio();
  if (!a) return;
  const { ac, out } = a;
  const now = ac.currentTime;
  for (const [freq, off, dur] of NOTES[kind]) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = WAVE[kind];
    osc.frequency.value = freq;
    const t0 = now + off;
    // soft attack + exponential decay so it doesn't click
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(PEAK, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}
