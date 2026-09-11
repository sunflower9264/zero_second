// Seeded PRNG so a given --seed always yields the same level pool. Determinism is what makes the
// generated manifest reviewable: re-running with the same seed must produce a byte-identical diff.
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) { return list[Math.floor(rng() * list.length) % list.length]; }
export function between(rng, min, max) { return min + rng() * (max - min); }
