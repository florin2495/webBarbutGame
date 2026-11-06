"use client";

let ctx: AudioContext | null = null;

/** Unlocks audio on iOS: must be called from a tap. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    // Web Audio unavailable
  }
}

/**
 * A short synthesized dice rattle: a few filtered noise clicks. No audio file needed.
 * Silently does nothing when Web Audio is unavailable or still locked.
 */
export function playRattle() {
  try {
    ctx ??= new AudioContext();
    const ac = ctx;
    if (ac.state === "suspended") void ac.resume();
    const clicks = 6;
    for (let i = 0; i < clicks; i++) {
      const at = ac.currentTime + i * 0.07 + Math.random() * 0.03;
      const len = Math.floor(ac.sampleRate * 0.03);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < len; j++) data[j] = (Math.random() * 2 - 1) * (1 - j / len) ** 3;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = 1800 + Math.random() * 1600;
      const gain = ac.createGain();
      gain.gain.value = 0.5 * (1 - i / (clicks + 2));
      src.connect(filter).connect(gain).connect(ac.destination);
      src.start(at);
    }
  } catch {
    // ignore
  }
}
