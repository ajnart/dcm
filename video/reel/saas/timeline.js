// The "Replace the SaaS you pay for" cut: 15 bars at the same 120 BPM, 30 s, on the same track and grid as the media cut.
import { BPM, BEAT, BAR, FPS, b } from "../timeline.js";
export { BPM, BEAT, BAR, FPS, b };
export const BARS = 15;
export const DUR = BARS * BAR;

// Beats in each swap; the swaps start with the drop at beat 16 and run into the riser at beat 48.
export const SWAP_BEATS = [6, 6, 6, 6, 8];
export const SWAP_AT = SWAP_BEATS.map((_, i) => b(16 + SWAP_BEATS.slice(0, i).reduce((s, n) => s + n, 0)));

export const SC = {
  hook: [b(0), b(6)], // "Replace the SaaS you pay for." over five rented tiles
  ask: [b(6), b(16)], // one sentence to an agent, the plan, Approve, the install command
  swaps: [b(16), b(48)], // the drop: five swaps, each coming up in the Dashboard
  flurry: [b(48), b(52)], // the track's biggest riser, the media cut's four phrases
  end: [b(52), DUR], // the final hit, the install line, self-host.fyi
};

// Source bars 4-7 are the track's quiet intro (lifted 8 dB), source bar 8 the drop (reel bar 4), then the groove up to
// source bar 15, the riser at source bar 35 and the final hit at source bar 48.
export const EDIT = [
  { reel: 0, src: 4, bars: 12, gainDb: 8, gainBars: 4 },
  { reel: 12, src: 35, bars: 1 },
  { reel: 13, src: 48, bars: 2 },
];
