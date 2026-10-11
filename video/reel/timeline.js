// The one timeline both the picture (scenes) and the soundtrack (audio/mix.mjs via cues.json) read.
// The reel is locked to the music: 120 BPM, a beat is 0.5 s, a bar is 2 s, and reel time 0 is a downbeat.
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const BARS = 17;
export const DUR = BARS * BAR;
export const FPS = 60;
export const b = (n) => n * BEAT; // beat n of the reel, in seconds

// Scene windows, in beats. Every boundary is a cut on a beat: hard, a match cut, a push or a whip.
export const SC = {
  hook: [b(0), b(12)], // bars 0-2: "Stop renting your software.", the rented wall, "Your servers."
  product: [b(12), b(20)], // bars 3-4: the drop, the wordmark, the install command and its Compose Project
  setup: [b(20), b(28)], // bars 5-6: the TUI, "Sets up every App."
  links: [b(28), b(35)], // bars 7-8: four Link cards
  board: [b(35), b(39)], // bars 8-9: the Homarr board
  pivot: [b(39), b(44)], // bars 9-10: "Don't want to learn the CLI?"
  agents: [b(44), b(56)], // bars 11-13: the skill in six agents
  flurry: [b(56), b(60)], // bar 14: one phrase per beat on the track's biggest riser
  end: [b(60), DUR], // bars 15-16: the end card on the final hit
};

// The soundtrack is an edit of the track on its bar lines: each segment plays `bars` bars of the
// source starting at source bar `src` (source bar n starts at TRACK.firstDownbeat + n * TRACK.bar).
export const EDIT = [
  { reel: 0, src: 5, bars: 14, gainDb: 8, gainBars: 3 }, // intro build (lifted 8 dB for the hook), the drop at reel bar 3, the groove, the louder second section from reel bar 11
  { reel: 14, src: 35, bars: 1 }, // the track's biggest riser under the flurry
  { reel: 15, src: 48, bars: 2 }, // the final hit and its ring-out under the end card
];
