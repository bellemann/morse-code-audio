// morse-code-audio: Morse code text, timing, WAV audio and audio decoding. Pure ESM, no DOM, no Web Audio, no dependencies.
// Morse is written with "." and "-", one space between letters and " / " between words.

// ITU-R M.1677-1 letters, figures and punctuation, then common non-ITU signs and accented letters.
// Order matters for decoding: the first character listed for a code wins.
const TABLE = [
  ["A", ".-"], ["B", "-..."], ["C", "-.-."], ["D", "-.."], ["E", "."], ["F", "..-."], ["G", "--."],
  ["H", "...."], ["I", ".."], ["J", ".---"], ["K", "-.-"], ["L", ".-.."], ["M", "--"], ["N", "-."],
  ["O", "---"], ["P", ".--."], ["Q", "--.-"], ["R", ".-."], ["S", "..."], ["T", "-"], ["U", "..-"],
  ["V", "...-"], ["W", ".--"], ["X", "-..-"], ["Y", "-.--"], ["Z", "--.."],
  ["0", "-----"], ["1", ".----"], ["2", "..---"], ["3", "...--"], ["4", "....-"], ["5", "....."],
  ["6", "-...."], ["7", "--..."], ["8", "---.."], ["9", "----."],
  [".", ".-.-.-"], [",", "--..--"], [":", "---..."], ["?", "..--.."], ["'", ".----."], ["-", "-....-"],
  ["/", "-..-."], ["(", "-.--."], [")", "-.--.-"], ['"', ".-..-."], ["=", "-...-"], ["+", ".-.-."],
  ["@", ".--.-."],
  // Not in the ITU recommendation, but widely used.
  ["!", "-.-.--"], ["&", ".-..."], [";", "-.-.-."], ["_", "..--.-"], ["$", "...-..-."],
  // É is ITU; the rest are the common international extensions.
  ["É", "..-.."], ["À", ".--.-"], ["Å", ".--.-"], ["Ä", ".-.-"], ["Æ", ".-.-"], ["Ç", "-.-.."],
  ["È", ".-..-"], ["Ł", ".-..-"], ["Ñ", "--.--"], ["Ö", "---."], ["Ø", "---."], ["Ü", "..--"],
  ["Ð", "..--."], ["Þ", ".--.."], ["Ĝ", "--.-."], ["Ĵ", ".---."], ["Ś", "...-..."], ["Ź", "--..-."], ["Ż", "--..-"],
];

// Prosigns are sent as one character without letter gaps. Written as <AR> in text.
export const PROSIGNS = {
  AR: ".-.-.", AS: ".-...", BT: "-...-", CT: "-.-.-", HH: "........", KN: "-.--.",
  SK: "...-.-", SN: "...-.", SOS: "...---...",
};

export const CODE = Object.fromEntries(TABLE);
// Curly quotes and the multiplication sign map to their base sign.
const ALIAS = { "’": "'", "‘": "'", "“": '"', "”": '"', "×": "X" };

const DECODE = {};
for (const [ch, code] of TABLE) DECODE[code] ??= ch;
for (const [name, code] of Object.entries(PROSIGNS)) DECODE[code] ??= `<${name}>`;

export const UNKNOWN = "#";

function codeFor(ch) {
  const up = (ALIAS[ch] ?? ch).toUpperCase();
  if (CODE[up]) return CODE[up];
  const base = up.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return base.length === 1 ? CODE[base] : undefined;
}

/** Text to Morse. Unknown characters become "#" and are listed in `unknown`. */
export function encode(text) {
  const words = [];
  const unknown = new Set();
  for (const word of String(text).split(/\s+/)) {
    if (!word) continue;
    const letters = [];
    for (const m of word.matchAll(/<([a-z]+)>|./gisu)) {
      const prosign = m[1] && PROSIGNS[m[1].toUpperCase()];
      if (prosign) { letters.push(prosign); continue; }
      for (const ch of m[1] ? m[0] : [m[0]]) {
        const code = codeFor(ch);
        if (code) letters.push(code);
        else { letters.push(UNKNOWN); unknown.add(ch); }
      }
    }
    words.push(letters.join(" "));
  }
  return { morse: words.join(" / "), unknown: [...unknown] };
}

/** Bring dots and dashes typed with other symbols (middle dot, bullet, underscore, minus, dashes) to "." and "-". */
export function normalizeMorse(input) {
  return String(input)
    .replace(/[·•∙⋅・*]/g, ".")
    .replace(/[_‐-―−﹘－]/g, "-");
}

/** True when the input looks like Morse: only dots, dashes, separators and spaces, with at least one dot or dash. */
export function isMorse(input) {
  const s = normalizeMorse(input).trim();
  return /[.-]/.test(s) && /^[.\-/|#\s]+$/.test(s);
}

/** Morse to text. Words split on "/", "|", a line break or 3+ spaces. Unknown codes become "#". */
export function decode(input) {
  const unknown = new Set();
  const words = normalizeMorse(input).trim().split(/\s*[/|\n]\s*|\s{3,}/).filter(Boolean).map((word) =>
    word.split(/\s+/).map((code) => {
      if (DECODE[code]) return DECODE[code];
      if (code !== UNKNOWN) unknown.add(code);
      return UNKNOWN;
    }).join(""));
  return { text: words.join(" "), unknown: [...unknown] };
}

/** Auto-detect direction and translate. */
export function translate(input) {
  if (isMorse(input)) {
    const r = decode(input);
    return { dir: "decode", output: r.text, unknown: r.unknown };
  }
  const r = encode(input);
  return { dir: "encode", output: r.morse, unknown: r.unknown };
}

/**
 * Seconds per element for a character speed `wpm` and an effective (Farnsworth) speed `fwpm` <= wpm.
 * PARIS standard: one word is 50 units, so a unit is 1.2 / wpm seconds.
 * Farnsworth (ARRL): extra delay ta = (60c - 37.2s) / (c s) is spread over the 19 gap units of PARIS.
 */
export function timing(wpm, fwpm = wpm) {
  const unit = 1.2 / wpm;
  const s = Math.min(fwpm, wpm);
  const ta = (60 * wpm - 37.2 * s) / (wpm * s);
  return { unit, letterGap: (3 * ta) / 19, wordGap: (7 * ta) / 19 };
}

/**
 * Tone schedule for a Morse string: tones [{ start, dur, pos }] in seconds, `pos` is the index of the
 * dot or dash in the string (for highlighting). `total` ends with the last tone.
 */
export function schedule(morse, { wpm = 20, fwpm = wpm } = {}) {
  const { unit, letterGap, wordGap } = timing(wpm, fwpm);
  const tones = [];
  let t = 0;
  let gap = 0; // gap owed before the next tone
  const s = normalizeMorse(morse);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "." || c === "-") {
      if (tones.length) t += gap;
      const dur = c === "." ? unit : 3 * unit;
      tones.push({ start: t, dur, pos: i });
      t += dur;
      gap = unit;
    } else if (c === "/" || c === "|" || c === "\n") {
      gap = Math.max(gap, wordGap);
    } else if (/\s/.test(c)) {
      gap = Math.max(gap, letterGap);
    }
  }
  return { tones, total: t, unit };
}

/** Render a schedule as mono samples in [-1, 1], with short raised-cosine ramps so the tone does not click. */
export function render(tones, { freq = 600, rate = 44100, pad = 0.1, ramp = 0.005, gain = 0.8 } = {}) {
  const end = tones.length ? tones.at(-1).start + tones.at(-1).dur : 0;
  const out = new Float32Array(Math.ceil((end + 2 * pad) * rate));
  const w = (2 * Math.PI * freq) / rate;
  for (const { start, dur } of tones) {
    const a = Math.round((start + pad) * rate);
    const n = Math.round(dur * rate);
    const r = Math.min(Math.round(ramp * rate), n >> 1);
    for (let k = 0; k < n; k++) {
      const env = k < r ? 0.5 - 0.5 * Math.cos((Math.PI * k) / r) : k >= n - r ? 0.5 - 0.5 * Math.cos((Math.PI * (n - k)) / r) : 1;
      out[a + k] = gain * env * Math.sin(w * (a + k));
    }
  }
  return out;
}

/** 16-bit PCM mono WAV file bytes. */
export function wav(samples, rate = 44100) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

// ---------- Decoding Morse from audio ----------

/** Goertzel power of `freq` in x[from, from + n). */
function goertzel(x, from, n, freq, rate) {
  const c = 2 * Math.cos((2 * Math.PI * freq) / rate);
  let s1 = 0, s2 = 0;
  for (let i = from; i < from + n; i++) {
    const s0 = x[i] + c * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - c * s1 * s2;
}

/** Two-means clustering of positive numbers on a log scale. Returns [low centre, high centre]. */
function twoMeans(values) {
  const logs = values.map(Math.log);
  let lo = Math.min(...logs), hi = Math.max(...logs);
  for (let it = 0; it < 20; it++) {
    const a = [], b = [];
    for (const v of logs) (v - lo < hi - v ? a : b).push(v);
    const mean = (arr, d) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : d);
    [lo, hi] = [mean(a, lo), mean(b, hi)];
  }
  return [Math.exp(lo), Math.exp(hi)];
}

/** Downsample to about 8 kHz by averaging (a crude low-pass; Morse tones sit well below 2 kHz). */
function decimate(samples, rate) {
  const f = Math.max(1, Math.floor(rate / 8000));
  if (f === 1) return { x: samples, rate };
  const x = new Float32Array(Math.floor(samples.length / f));
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < f; k++) s += samples[i * f + k];
    x[i] = s / f;
  }
  return { x, rate: rate / f };
}

/** Find the strongest steady tone between 300 and 1500 Hz, judged on the loudest 20 ms blocks. */
export function detectTone(x, rate) {
  const n = Math.round(rate * 0.02);
  const blocks = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let e = 0;
    for (let k = i; k < i + n; k++) e += x[k] * x[k];
    blocks.push([e, i]);
  }
  blocks.sort((a, b) => b[0] - a[0]);
  const top = blocks.slice(0, Math.max(1, Math.min(150, Math.ceil(blocks.length * 0.25))));
  const score = (f) => top.reduce((s, [, i]) => s + goertzel(x, i, n, f, rate), 0);
  let best = 300, bestScore = -1;
  for (let f = 300; f <= 1500; f += 20) { const s = score(f); if (s > bestScore) [best, bestScore] = [f, s]; }
  for (let f = best - 15; f <= best + 15; f += 5) { const s = score(f); if (s > bestScore) [best, bestScore] = [f, s]; }
  return best;
}

/** Tone level in sliding Goertzel windows, split into on/off runs (in hops) with the dot length estimated. */
function readRuns(x, rate, tone, winSec, hop, minRun) {
  const win = Math.round(rate * winSec);
  const env = [];
  for (let i = 0; i + win <= x.length; i += hop) env.push(Math.sqrt(goertzel(x, i, win, tone, rate)) / win);
  if (!env.length) return null;
  const sorted = [...env].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.2)];
  const hi = sorted[Math.floor(sorted.length * 0.97)];
  if (!(hi > 6 * lo + 1e-4)) return null;
  const threshold = (lo + hi) / 2;

  // Runs of on/off, then fold glitches shorter than minRun hops into their neighbours.
  const raw = [];
  for (const v of env) {
    const on = v > threshold;
    if (raw.length && raw.at(-1).on === on) raw.at(-1).len++;
    else raw.push({ on, len: 1 });
  }
  const runs = [];
  for (const r of raw) {
    const last = runs.at(-1);
    if (last && (r.len < minRun || last.on === r.on)) last.len += r.len;
    else runs.push({ ...r });
  }
  if (runs[0] && !runs[0].on) runs.shift();
  if (runs.at(-1) && !runs.at(-1).on) runs.pop();
  const ons = runs.filter((r) => r.on).map((r) => r.len);
  const gaps = runs.filter((r) => !r.on).map((r) => r.len);
  if (!ons.length) return null;

  // Dot length: dots and dashes are 1:3. If all elements look alike, compare them with the shortest gaps.
  let unit;
  const [dit, dah] = twoMeans(ons);
  if (dah / dit > 2) {
    const split = Math.sqrt(dit * dah);
    const d = ons.filter((v) => v < split), D = ons.filter((v) => v >= split);
    unit = (d.reduce((s, v) => s + v, 0) + D.reduce((s, v) => s + v, 0) / 3) / ons.length;
  } else if (gaps.length) {
    const gap = twoMeans(gaps)[0];
    unit = dit / gap > 2 ? dit / 3 : dit;
  } else {
    unit = (dit * hop) / rate > 0.15 ? dit / 3 : dit;
  }
  return { runs, unit };
}

/**
 * Decode Morse from mono audio samples. Finds the tone, follows its level with a sliding Goertzel filter,
 * splits it into on and off runs, estimates the dot length and so the speed, then reads dots, dashes and gaps.
 * Returns { morse, text, wpm, freq } (empty strings when no clear tone is found).
 */
export function decodeAudio(samples, sampleRate, { freq } = {}) {
  const empty = { morse: "", text: "", wpm: 0, freq: 0 };
  const { x, rate } = decimate(samples, sampleRate);
  if (x.length < rate * 0.05) return empty;
  const tone = freq || detectTone(x, rate);

  // First pass with a 10 ms window finds the dot length. A second pass with a window of about half a dot
  // narrows the filter, which rejects much more noise at slower speeds.
  const hop = Math.round(rate * 0.0025);
  let r = readRuns(x, rate, tone, 0.01, hop, 3);
  if (!r) return { ...empty, freq: tone };
  const unitSec = (r.unit * hop) / rate;
  if (unitSec > 0.024) r = readRuns(x, rate, tone, Math.min(0.5 * unitSec, 0.08), hop, Math.round(r.unit / 3)) || r;
  const { runs, unit } = r;
  const gaps = runs.filter((g) => !g.on).map((g) => g.len);

  // Letter and word gaps: 3 and 7 units, or longer with Farnsworth spacing. Cluster the long gaps when both kinds occur.
  const long = gaps.filter((g) => g >= 2 * unit);
  let wordSplit = 5 * unit;
  if (long.length > 1) {
    const [a, b] = twoMeans(long);
    if (b / a > 1.8) wordSplit = Math.sqrt(a * b);
  }

  let morse = "";
  for (const r of runs) {
    if (r.on) morse += r.len < 2 * unit ? "." : "-";
    else if (r.len >= wordSplit) morse += " / ";
    else if (r.len >= 2 * unit) morse += " ";
  }
  const wpm = Math.round(1.2 / ((unit * hop) / rate));
  return { morse, text: decode(morse).text, wpm, freq: tone };
}

// ---------- Koch method ----------

/** Koch order as used by most trainers (LCWO): start with K and M, add one character at a time. */
export const KOCH = "K M U R E S N A P T L W I . J Z = F O Y , V G 5 / Q 9 2 H 3 8 B ? 4 7 C 1 D 6 0 X".split(" ");

/** Ready for the next character: at least 20 answers since the last one was added, and 90% of the last 20 right. */
export function kochReady(results) {
  const last = results.slice(-20);
  return last.length === 20 && last.filter(Boolean).length >= 18;
}
