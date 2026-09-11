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
export const DASH_COOLDOWN = 0.64;
export const BOUNDS = { left: 0, right: W, top: FIELD_TOP, bottom: FIELD_BOTTOM };

// Chasers sidestep the aim line once the player has been holding for a beat. A snap aim still
// lands; a long deliberation lets the target walk out of the corridor, which is the only pressure
// the free slow-motion otherwise removes. The delay keeps a first-time player, who holds to look
// around, from being punished for exploring.
// `base` has to clear the dash's hit radius (enemy.r + 13) inside the extra hold time, or the
// sidestep is invisible at low tiers. At 0.14x world speed, 260 px/s of lateral travel is roughly
// 36px per extra second of holding — which is the hit radius, so ~2s of deliberation loses the shot.
// The delay shrinks as tiers climb, so the opening levels give a first-time player room to look
// around and the late ones do not. None of this affects route verification: the solver holds for
// 0.7s, which is below every delay, so a dodge never fires during a verified replay.
export const DODGE = { delayBase: 1.7, delayPerTier: 0.018, delayMin: 0.85, range: 340, width: 62, base: 320, perTier: 3, armoredScale: 0.6, closeFraction: 0.35 };
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
