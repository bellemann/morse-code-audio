# morse-code-audio

Morse code in plain JavaScript: translate text both ways, build exact ITU timing with Farnsworth spacing, render
click-free audio to a WAV file, and decode Morse from a recording or a live microphone. One ES module, no
dependencies, no DOM. Runs in the browser and in Node 18+.

**Live demo:** [morsecodefree.com](https://morsecodefree.com) uses this code for its
[translator](https://morsecodefree.com/), [audio decoder](https://morsecodefree.com/morse-code-audio-decoder/) and
[Koch trainer](https://morsecodefree.com/learn-morse-code/).

## Install

```sh
npm install morse-code-audio
```

Or in the browser without a build step:

```html
<script type="module">
  import { encode } from "https://cdn.jsdelivr.net/npm/morse-code-audio/+esm";
</script>
```

## Translate

```js
import { encode, decode, translate } from "morse-code-audio";

encode("SOS help").morse;          // "... --- ... / .... . .-.. .--."
decode("... --- ...").text;        // "SOS"
translate("-- --- .-. ... .");     // { dir: "decode", output: "MORSE", unknown: [] }
encode("<AR> done").morse;         // prosigns in angle brackets: ".-.-. / -.. --- -. ."
```

Morse is written with `.` and `-`, one space between letters and ` / ` between words. Input in other notations
(`·`, `•`, `_`, `−`, `|` as a word break) is normalized. Unknown characters become `#` and are listed in `unknown`.
The table covers ITU-R M.1677-1 letters, figures and punctuation, common extra signs, accented letters and prosigns.

## Audio

```js
import { encode, schedule, render, wav } from "morse-code-audio";
import { writeFileSync } from "node:fs";

const { tones } = schedule(encode("CQ CQ").morse, { wpm: 20, fwpm: 12 }); // 20 WPM characters, 12 WPM Farnsworth
const samples = render(tones, { freq: 600 });                             // Float32Array, raised-cosine ramps
writeFileSync("cq.wav", wav(samples));                                    // 16-bit mono WAV
```

`schedule` returns each tone's `start`, `dur` and `pos` (its index in the Morse string), so you can highlight dots
and dashes in sync with playback. `timing(wpm, fwpm)` gives the unit, letter gap and word gap in seconds (PARIS
standard, ARRL Farnsworth formula).

## Decode Morse from audio

```js
import { decodeAudio } from "morse-code-audio";

const { text, morse, wpm, freq } = decodeAudio(samples, 44100);
```

It finds the strongest tone between 300 and 1500 Hz, follows its level with a sliding Goertzel filter, estimates the
dot length (and so the speed) by clustering, and reads dots, dashes, letter and word gaps. Pass `{ freq }` to skip
tone detection. It handles noise, speed changes between recordings and Farnsworth spacing.

From a file in the browser:

```js
const ac = new AudioContext();
const buffer = await ac.decodeAudioData(await file.arrayBuffer());
const result = decodeAudio(buffer.getChannelData(0), buffer.sampleRate);
```

From the microphone, collect a few seconds of samples and decode the window repeatedly:

```js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
const ac = new AudioContext();
const src = ac.createMediaStreamSource(stream);
const proc = ac.createScriptProcessor(4096, 1, 1);
const chunks = [];
proc.onaudioprocess = (e) => {
  chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  if (chunks.length > 300) chunks.shift(); // keep about the last 30 seconds
};
src.connect(proc).connect(ac.destination);

setInterval(() => {
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  console.log(decodeAudio(all, ac.sampleRate).text);
}, 1000);
```

Turn off echo cancellation and noise suppression as shown: browsers otherwise treat a steady tone as noise and
remove it.

## Koch method

```js
import { KOCH, kochReady } from "morse-code-audio";

KOCH.slice(0, 2);       // ["K", "M"]: the order most trainers use, one new character at a time
kochReady(lastAnswers); // true after 20 answers with at least 18 right: add the next character
```

## Hand key

Read a telegraph key, a space bar or a touch button. `tapper()` tells dots from dashes and learns the sender's speed as they go.

```js
import { tapper } from "morse-code-audio";

const key = tapper();
key.press(0.07);   // "." : seconds the key was held
key.press(0.21);   // "-"
key.wpm;           // about 17 after a few letters
key.letterGap;     // seconds of silence that end a letter
key.wordGap;       // seconds of silence that end a word
```

## Test

```sh
npm test
```

## License

MIT
