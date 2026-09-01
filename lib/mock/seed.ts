/**
 * PRNG determinístico. Mesma seed => mesma sequência, para que os dados
 * mockados sejam estáveis entre renders, refreshes e ambientes.
 */

/** FNV-1a — string para inteiro de 32 bits. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 — gerador rápido no intervalo [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Float em [min, max). */
  range(min: number, max: number): number;
  /** Inteiro em [min, max]. */
  int(min: number, max: number): number;
  /** Escolhe um item do array. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: string | number): Rng {
  const next = mulberry32(typeof seed === "string" ? hashSeed(seed) : seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] as (typeof items)[number],
  };
}
