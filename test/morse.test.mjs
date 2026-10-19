import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode, decode, isMorse, translate, normalizeMorse, timing, schedule, render, wav, decodeAudio, detectTone, CODE, PROSIGNS, KOCH, kochReady, tapper,
} from "../index.js";

// Deterministic generator (mulberry32) and Gaussian noise for repeatable signal tests.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function addNoise(x, sigma, seed = 1) {
  const r = seeded(seed);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const g = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
    y[i] = x[i] + sigma * g;
  }
  return y;
}
function signal(text, { wpm, fwpm = wpm, freq = 600, rate = 8000 }) {
  return render(schedule(encode(text).morse, { wpm, fwpm }).tones, { freq, rate, pad: 0.3 });
}

test("encodes letters, digits and punctuation", () => {
  assert.equal(encode("SOS").morse, "... --- ...");
  assert.equal(encode("Hello, World!").morse, ".... . .-.. .-.. --- --..-- / .-- --- .-. .-.. -.. -.-.--");
  assert.equal(encode("73").morse, "--... ...--");
  assert.equal(encode("  i   love\nyou ").morse, ".. / .-.. --- ...- . / -.-- --- ..-");
  assert.equal(encode("").morse, "");
});

test("encodes accented letters, with a fallback to the base letter", () => {
  assert.equal(encode("é").morse, "..-..");
  assert.equal(encode("Ñ").morse, "--.--");
  assert.equal(encode("ü").morse, "..--");
  assert.equal(encode("í").morse, ".."); // no own code: falls back to I
  assert.equal(encode("’").morse, CODE["'"]);
});

test("unknown characters become # and are reported", () => {
  const r = encode("a~b");
  assert.equal(r.morse, ".- # -...");
  assert.deepEqual(r.unknown, ["~"]);
  assert.equal(decode(".- ......- -...").text, "A#B");
  assert.deepEqual(decode(".- ......- -...").unknown, ["......-"]);
});

test("prosigns encode as one character and decode back", () => {
  assert.equal(encode("<SOS>").morse, "...---...");
  assert.equal(encode("cq <sk>").morse, "-.-. --.- / ...-.-");
  assert.equal(decode("...-.-").text, "<SK>");
  assert.equal(decode("...---...").text, "<SOS>");
  assert.equal(decode("........").text, "<HH>");
  // AR shares its code with "+", which wins when decoding.
  assert.equal(encode("<AR>").morse, PROSIGNS.AR);
  assert.equal(decode(PROSIGNS.AR).text, "+");
});

test("round trip text to Morse to text", () => {
  for (const s of ["THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 0123456789", "WHAT? (YES) A/B \"OK\" 1+1=2 @HOME", "CAFÉ ÑANDÚ"]) {
    assert.equal(decode(encode(s).morse).text, s.replace("Ú", "U"));
  }
});

test("decode accepts other dot and dash symbols and word separators", () => {
  assert.equal(normalizeMorse("\u00B7\u2212_\u2013"), ".---");
  assert.equal(decode("··· −−− ···").text, "SOS");
  assert.equal(decode(".. | .-.. --- ...- .").text, "I LOVE");
  assert.equal(decode(".. \n .-..").text, "I L");
  assert.equal(decode("..   .-..").text, "I L");
});

test("auto-detects the direction", () => {
  assert.equal(isMorse("... --- ..."), true);
  assert.equal(isMorse("-"), true);
  assert.equal(isMorse(".- # -..."), true);
  assert.equal(isMorse("sos"), false);
  assert.equal(isMorse("e.g."), false);
  assert.equal(isMorse(" / "), false);
  assert.equal(isMorse(""), false);
  assert.equal(translate("sos").output, "... --- ...");
  assert.equal(translate("... --- ...").output, "SOS");
  assert.equal(translate("... --- ...").dir, "decode");
});

test("timing follows PARIS: 50 units per word at the set speed", () => {
  for (const wpm of [5, 13, 20, 40]) {
    const { total, unit } = schedule(encode("PARIS").morse, { wpm });
    assert.ok(Math.abs(unit - 1.2 / wpm) < 1e-12);
    assert.ok(Math.abs(total + 7 * unit - 60 / wpm) < 1e-9); // plus the trailing word gap
  }
});

test("Farnsworth spacing keeps characters fast and slows the word rate", () => {
  const c = 18, s = 5;
  const t = timing(c, s);
  const { tones, total, unit } = schedule(encode("PARIS").morse, { wpm: c, fwpm: s });
  assert.equal(tones[0].dur, 1.2 / c); // dot at character speed
  assert.ok(t.letterGap > 3 * unit && t.wordGap > 7 * unit);
  assert.ok(Math.abs(total + t.wordGap - 60 / s) < 1e-9);
  // Effective speed above character speed is clamped to character speed.
  assert.deepEqual(timing(20, 30), timing(20, 20));
});

test("schedule positions point at the dots and dashes", () => {
  const m = "... ---";
  const { tones } = schedule(m, { wpm: 20 });
  assert.deepEqual(tones.map((t) => m[t.pos]), [".", ".", ".", "-", "-", "-"]);
  assert.equal(schedule("", { wpm: 20 }).tones.length, 0);
});

test("WAV header and sample count are correct", () => {
  const rate = 8000;
  const x = render(schedule(".-", { wpm: 20 }).tones, { rate, pad: 0.1 });
  const bytes = wav(x, rate);
  const v = new DataView(bytes.buffer);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), "WAVE");
  assert.equal(v.getUint32(24, true), rate);
  assert.equal(v.getUint32(40, true), x.length * 2);
  assert.equal(bytes.length, 44 + x.length * 2);
  // 0.06 s dot + 0.06 gap + 0.18 dash + 2 x 0.1 s padding
  assert.ok(Math.abs(x.length / rate - 0.5) < 0.01);
  assert.ok(Math.max(...x) <= 0.8001 && Math.max(...x) > 0.7);
});

test("detects the tone frequency", () => {
  for (const freq of [450, 600, 800, 1000]) {
    const f = detectTone(signal("TEST", { wpm: 20, freq }), 8000);
    assert.ok(Math.abs(f - freq) <= 10, `${f} vs ${freq}`);
  }
});

const SENTENCE = "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 73";

for (const wpm of [10, 20, 30]) {
  test(`decodes a clean signal at ${wpm} WPM and estimates the speed`, () => {
    const r = decodeAudio(signal(SENTENCE, { wpm }), 8000);
    assert.equal(r.text, SENTENCE);
    assert.ok(Math.abs(r.wpm - wpm) <= Math.max(1, wpm * 0.1), `wpm ${r.wpm}`);
  });

  test(`decodes a noisy signal at ${wpm} WPM`, () => {
    // Tone amplitude 0.8, Gaussian noise sigma 0.4 over the full 4 kHz band.
    const r = decodeAudio(addNoise(signal(SENTENCE, { wpm, freq: 700 }), 0.4, wpm), 8000);
    assert.equal(r.text, SENTENCE);
  });
}

test("decodes 44.1 kHz audio, 40 WPM and Farnsworth spacing", () => {
  assert.equal(decodeAudio(signal("CQ CQ DE N0CALL", { wpm: 40, rate: 44100 }), 44100).text, "CQ CQ DE N0CALL");
  assert.equal(decodeAudio(signal("HELLO WORLD", { wpm: 5, freq: 550 }), 8000).text, "HELLO WORLD");
  assert.equal(decodeAudio(signal("LEARN MORSE CODE", { wpm: 18, fwpm: 8 }), 8000).text, "LEARN MORSE CODE");
});

test("single-kind signals: all dots and all dashes", () => {
  assert.equal(decodeAudio(signal("EEE", { wpm: 20 }), 8000).text, "EEE");
  assert.equal(decodeAudio(signal("OM", { wpm: 20 }), 8000).text, "OM");
  assert.equal(decodeAudio(signal("SH", { wpm: 20 }), 8000).text, "SH");
});

test("returns nothing for silence or plain noise", () => {
  assert.equal(decodeAudio(new Float32Array(16000), 8000).text, "");
  assert.equal(decodeAudio(addNoise(new Float32Array(16000), 0.3), 8000).text, "");
});

test("Koch order covers 41 distinct characters that all have a code", () => {
  assert.equal(KOCH.length, 41);
  assert.equal(new Set(KOCH).size, 41);
  assert.deepEqual(KOCH.slice(0, 2), ["K", "M"]);
  for (const c of KOCH) assert.ok(CODE[c], c);
});

test("Koch advances at 90% of the last 20 answers", () => {
  assert.equal(kochReady(Array(19).fill(true)), false);
  assert.equal(kochReady([...Array(18).fill(true), false, false]), true);
  assert.equal(kochReady([...Array(17).fill(true), false, false, false]), false);
  assert.equal(kochReady([false, false, false, ...Array(20).fill(true)]), true);
});

test("hand key reader tells dots from dashes and learns the speed", () => {
  // A slow beginner (0.2 s dots) and a 20 WPM operator, both with uneven timing.
  for (const [dot, wobble] of [[0.2, 0.3], [0.06, 0.2]]) {
    const r = seeded(7);
    const t = tapper();
    let sent = "";
    for (const code of encode("PARIS PARIS").morse.replace(/[ /]/g, "")) sent += t.press((code === "." ? dot : 3 * dot) * (1 + (r() - 0.5) * wobble));
    const paris = encode("PARIS").morse.replace(/ /g, "");
    assert.equal(sent.slice(-paris.length), paris, `dot ${dot}`);
    assert.ok(Math.abs(t.unit - dot) / dot < 0.2, `unit ${t.unit} for dot ${dot}`);
  }
});
