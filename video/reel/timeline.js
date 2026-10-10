// The one timeline both the picture (scenes) and the soundtrack (audio/mix.mjs via cues.json) read.
// The reel is locked to the music: 120 BPM, a beat is 0.5 s, a bar is 2 s, and reel time 0 is a downbeat.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const BARS = 16;
export const DUR = BARS * BAR;
export const FPS = 60;
export const b = (n) => n * BEAT; // beat n of the reel, in seconds

// Scene windows, in beats. Every boundary is a hard cut or a mask that starts on a beat.
export const SC = {
  hook: [b(0), b(12)], // bars 0-2: "Stop renting your software.", the rented wall, "Your servers."
  product: [b(12), b(20)], // bars 3-4: the drop, the wordmark, "One command. A whole stack."
  setup: [b(20), b(24)], // bar 5: the TUI, "Sets up every App."
  links: [b(24), b(32)], // bars 6-7: four Link cards
  board: [b(32), b(35)], // bar 8, beats 1-3: the Homarr board
  pivot: [b(35), b(40)], // bar 8 beat 4 to bar 9: "Don't want to learn the CLI?"
  agents: [b(40), b(52)], // bars 10-12: the skill in six agents
  flurry: [b(52), b(56)], // bar 13: one phrase per beat on the track's biggest riser
  end: [b(56), DUR], // bars 14-15: the end card on the final hit, still from beat 59.5
};

// The soundtrack is an edit of the track on its bar lines: each segment plays `bars` bars of the
// source starting at source bar `src` (source bar n starts at TRACK.firstDownbeat + n * TRACK.bar).
export const EDIT = [
  { reel: 0, src: 5, bars: 9, gainDb: 8, gainBars: 3 }, // intro build (lifted 8 dB for the hook), the drop at reel bar 3
  { reel: 9, src: 15, bars: 4 }, // the fill into the second section under the pivot, then the agents
  { reel: 13, src: 35, bars: 1 }, // the track's biggest riser under the flurry
  { reel: 14, src: 48, bars: 2 }, // the final hit and its ring-out under the end card
];
