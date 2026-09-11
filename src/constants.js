// Single source of truth for the play-field geometry. The level solver and the level generator run
// the real game loop outside the browser, so they must read these rather than restate them — a
// silent drift here would validate generated levels against physics the game does not have.
export const W = 720;
export const H = 1280;
export const FIELD_TOP = 118;
export const FIELD_BOTTOM = 1210;
export const MAX_DASH = 270;
export const PLAYER_R = 19;
export const COMBO_WINDOW = 2.25;   // seconds of *real* time to land the next kill before the chain drops
export const BOUNDS = { left: 0, right: W, top: FIELD_TOP, bottom: FIELD_BOTTOM };
export const TAU = Math.PI * 2;

// Solver tuning: shared by scripts/audit-levels.mjs and scripts/gen-daily.mjs.
export const SOLVER = {
  coverOffset: 35,   // how far outside a wall corner a cover candidate is sampled
  dedupGrid: 12,     // endpoint rounding used to collapse near-identical aims
  nodeGrid: 35,      // player position quantisation used to dedupe search nodes
  routeHold: 0.7,    // touch hold, in seconds, used when replaying a route
  routeStep: 0.08,   // simulated settle time after a release
  depth: 35,
  beamWidth: 55,
  aimClamp: { minX: 20, maxX: W - 20, minY: FIELD_TOP + 20, maxY: FIELD_BOTTOM - 20 },
};
