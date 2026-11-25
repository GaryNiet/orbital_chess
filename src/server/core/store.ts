/**
 * The subset of the Devvit Redis client that the game logic uses.
 * Devvit's `redis` satisfies this type directly; `MemoryStore` implements it
 * for unit tests and the local (non-Reddit) dev server.
 */
export type ZMember = { member: string; score: number };

export type Store = {
  get(key: string): Promise<string | undefined>;
  set(
    key: string,
    value: string,
    options?: { nx?: boolean; expiration?: Date }
  ): Promise<string>;
  del(...keys: string[]): Promise<void>;
  incrBy(key: string, value: number): Promise<number>;
  hGet(key: string, field: string): Promise<string | undefined>;
  hSet(key: string, fieldValues: { [field: string]: string }): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrBy(key: string, field: string, value: number): Promise<number>;
  hSetNX(key: string, field: string, value: string): Promise<number>;
  hMGet(key: string, fields: string[]): Promise<(string | null)[]>;
  zAdd(key: string, ...members: ZMember[]): Promise<number>;
  zIncrBy(key: string, member: string, value: number): Promise<number>;
  zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { by: 'rank' | 'score' | 'lex'; reverse?: boolean }
  ): Promise<ZMember[]>;
  zRem(key: string, members: string[]): Promise<number>;
  zScore(key: string, member: string): Promise<number | undefined>;
  zCard(key: string): Promise<number>;
  /** Ascending rank (lowest score = 0). */
  zRank(key: string, member: string): Promise<number | undefined>;
};

type Entry =
  | { kind: 'str'; value: string; expiresAt: number | null }
  | { kind: 'hash'; value: Map<string, string> }
  | { kind: 'zset'; value: Map<string, number> };

/** In-memory Store. Only rank-based zRange is supported. */
export class MemoryStore implements Store {
  private data = new Map<string, Entry>();
  now: () => number = () => Date.now();

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e && e.kind === 'str' && e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private hash(key: string): Map<string, string> {
    const e = this.live(key);
    if (e?.kind === 'hash') return e.value;
    const value = new Map<string, string>();
    this.data.set(key, { kind: 'hash', value });
    return value;
  }

  private zset(key: string): Map<string, number> {
    const e = this.live(key);
    if (e?.kind === 'zset') return e.value;
    const value = new Map<string, number>();
    this.data.set(key, { kind: 'zset', value });
    return value;
  }

  async get(key: string) {
    const e = this.live(key);
    return e?.kind === 'str' ? e.value : undefined;
  }

  async set(key: string, value: string, options?: { nx?: boolean; expiration?: Date }) {
    if (options?.nx && this.live(key)) return '';
    this.data.set(key, {
      kind: 'str',
      value,
      expiresAt: options?.expiration ? options.expiration.getTime() : null,
    });
    return 'OK';
  }

  async del(...keys: string[]) {
    for (const k of keys) this.data.delete(k);
  }

  async incrBy(key: string, value: number) {
    const next = Number((await this.get(key)) ?? '0') + value;
    await this.set(key, String(next));
    return next;
  }

  async hGet(key: string, field: string) {
    const e = this.live(key);
    return e?.kind === 'hash' ? e.value.get(field) : undefined;
  }

  async hSet(key: string, fieldValues: { [field: string]: string }) {
    const h = this.hash(key);
    let added = 0;
    for (const [f, v] of Object.entries(fieldValues)) {
      if (!h.has(f)) added++;
      h.set(f, v);
    }
    return added;
  }

  async hGetAll(key: string) {
    const e = this.live(key);
    return e?.kind === 'hash' ? Object.fromEntries(e.value) : {};
  }

  async hIncrBy(key: string, field: string, value: number) {
    const h = this.hash(key);
    const next = Number(h.get(field) ?? '0') + value;
    h.set(field, String(next));
    return next;
  }

  async hSetNX(key: string, field: string, value: string) {
    const h = this.hash(key);
    if (h.has(field)) return 0;
    h.set(field, value);
    return 1;
  }

  async hMGet(key: string, fields: string[]) {
    const e = this.live(key);
    return fields.map((f) => (e?.kind === 'hash' ? (e.value.get(f) ?? null) : null));
  }

  async zIncrBy(key: string, member: string, value: number) {
    const z = this.zset(key);
    const next = (z.get(member) ?? 0) + value;
    z.set(member, next);
    return next;
  }

  async zAdd(key: string, ...members: ZMember[]) {
    const z = this.zset(key);
    let added = 0;
    for (const m of members) {
      if (!z.has(m.member)) added++;
      z.set(m.member, m.score);
    }
    return added;
  }

  async zRange(
    key: string,
    start: number | string,
    stop: number | string,
    options?: { by: 'rank' | 'score' | 'lex'; reverse?: boolean }
  ) {
    if (options && options.by !== 'rank') throw new Error('MemoryStore: only rank ranges');
    const e = this.live(key);
    if (e?.kind !== 'zset') return [];
    const sorted = [...e.value.entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
    if (options?.reverse) sorted.reverse();
    const n = sorted.length;
    let s = Number(start);
    let t = Number(stop);
    if (s < 0) s += n;
    if (t < 0) t += n;
    return sorted.slice(Math.max(0, s), t + 1);
  }

  async zRem(key: string, members: string[]) {
    const z = this.zset(key);
    let removed = 0;
    for (const m of members) if (z.delete(m)) removed++;
    return removed;
  }

  async zScore(key: string, member: string) {
    const e = this.live(key);
    return e?.kind === 'zset' ? e.value.get(member) : undefined;
  }

  async zCard(key: string) {
    const e = this.live(key);
    return e?.kind === 'zset' ? e.value.size : 0;
  }

  async zRank(key: string, member: string) {
    const all = await this.zRange(key, 0, -1, { by: 'rank' });
    const i = all.findIndex((m) => m.member === member);
    return i === -1 ? undefined : i;
  }
}
