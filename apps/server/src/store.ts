// Optional room persistence so games survive a server restart / Render free-tier
// spin-down. Enabled by setting REDIS_URL (e.g. an Upstash rediss:// URL). When
// unset, a no-op store is used and everything stays in memory as before.
import type { GameState } from '@slave/engine';

/** The durable slice of a Room. Sockets/timers are runtime-only and rebuilt on load. */
export interface PersistedRoom {
  state: GameState;
  pendingRounds: number;
  tokens: [string, string][]; // playerId -> token
}

export interface RoomStore {
  readonly enabled: boolean;
  loadAll(): Promise<PersistedRoom[]>;
  save(code: string, room: PersistedRoom): void;
  remove(code: string): void;
}

const PREFIX = 'slave:room:';
const KEY = (code: string) => `${PREFIX}${code}`;
const TTL_SECONDS = 6 * 60 * 60; // a room with no activity for 6h expires

class NoopStore implements RoomStore {
  readonly enabled = false;
  async loadAll(): Promise<PersistedRoom[]> {
    return [];
  }
  save(): void {}
  remove(): void {}
}

class RedisStore implements RoomStore {
  readonly enabled = true;
  // `redis` is an ioredis client; typed as any to avoid a hard type dependency.
  constructor(private redis: { keys: Function; mget: Function; set: Function; del: Function }) {}

  async loadAll(): Promise<PersistedRoom[]> {
    const keys: string[] = await this.redis.keys(`${PREFIX}*`);
    if (!keys.length) return [];
    const vals: (string | null)[] = await this.redis.mget(keys);
    const out: PersistedRoom[] = [];
    for (const v of vals) {
      if (!v) continue;
      try {
        out.push(JSON.parse(v) as PersistedRoom);
      } catch {
        /* skip corrupt entries */
      }
    }
    return out;
  }

  save(code: string, room: PersistedRoom): void {
    // Fire-and-forget; persistence is best-effort and must never block a move.
    Promise.resolve(this.redis.set(KEY(code), JSON.stringify(room), 'EX', TTL_SECONDS)).catch(
      (e: unknown) => console.error('[slave] redis save failed:', e),
    );
  }

  remove(code: string): void {
    Promise.resolve(this.redis.del(KEY(code))).catch((e: unknown) =>
      console.error('[slave] redis remove failed:', e),
    );
  }
}

export async function createStore(): Promise<RoomStore> {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[slave] REDIS_URL not set — rooms are in-memory only (lost on restart)');
    return new NoopStore();
  }
  try {
    const mod: any = await import('ioredis');
    const Redis = mod.default ?? mod.Redis ?? mod;
    const client = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    client.on('error', (e: unknown) => console.error('[slave] redis error:', e));
    console.log('[slave] room persistence enabled via REDIS_URL');
    return new RedisStore(client);
  } catch (e) {
    console.error('[slave] failed to init redis, falling back to in-memory:', e);
    return new NoopStore();
  }
}
