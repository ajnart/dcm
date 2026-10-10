// The one timeline both the picture (scenes) and the soundtrack (audio/synth.mjs via cues.json) read.
// Scene windows overlap by the length of their transition.
export const DUR = 52.6;
export const FPS = 60;
export const BPM = 120;

export const SC = {
  hook: [0, 9.0], // hook, rented wall, flip to "Your servers."
  product: [9.0, 14.9], // violet flood, wordmark, "One command. A whole stack."
  preboot: [14.4, 18.6], // starfield, "Let self-host do it.", image pulls
  setup: [18.5, 22.1], // TUI Activity, "Sets up every App."
  links: [22.0, 28.1], // four Link cards, "Links them together."
  board: [28.0, 31.1], // Homarr board, "Then builds your dashboard."
  pivot: [31.0, 35.1], // "Don't want to learn the CLI?"
  agents: [35.0, 46.7], // the skill in six agents
  end: [46.6, DUR], // end card, static for the last 4+ s
};

// A scene stays on screen (and keeps drawing) under the next scene's reveal until that reveal has covered it.
const TAIL = { preboot: 0.5, setup: 0.45, links: 0.5, board: 0.55, pivot: 0.55, agents: 0.7 };
export const shown = (k) => SC[k][1] + (TAIL[k] || 0);

// Music sections start on the 0.5 s beat grid (120 BPM).
export const SECTIONS = [
  { t: 0, name: "build" }, // hook: pulse, pads, riser into the flood
  { t: 9, name: "lift" }, // "One command": full groove
  { t: 22, name: "drive" }, // Links: groove with brighter arps
  { t: 31, name: "breakdown" }, // "Don't want to learn the CLI?"
  { t: 35, name: "rebuild" }, // agents: half-time, building
  { t: 47, name: "payoff" }, // end card: impact, full chord, ring out
];
