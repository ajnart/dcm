// The "Replace the SaaS you pay for" cut: its own timeline and scenes, on the media cut's engine, styles and sound.
import * as hook from "./hook.js";
import * as ask from "./ask.js";
import * as swaps from "./swaps.js";
import * as end from "./end.js";
import * as flurry from "../flurry.js";
import { SC } from "./timeline.js";

export { DUR, FPS, BPM, BEAT, SC, EDIT } from "./timeline.js";
export const scenes = [hook, ask, swaps, { build: (tl) => flurry.build(tl, SC.flurry) }, end];
export const settled = end.SETTLED;
