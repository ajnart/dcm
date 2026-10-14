// The media cut: "Stop renting your software", the Compose Project, Homarr and the agents. Its timeline is timeline.js.
import * as hook from "./hook.js";
import * as product from "./product.js";
import * as setup from "./setup.js";
import * as links from "./links.js";
import * as board from "./board.js";
import * as pivot from "./pivot.js";
import * as agents from "./agents.js";
import * as flurry from "./flurry.js";
import * as end from "./end.js";

export { DUR, FPS, BPM, BEAT, SC, EDIT } from "./timeline.js";
export const scenes = [hook, product, setup, links, board, pivot, agents, flurry, end];
export const settled = end.SETTLED;
