// Verifies room persistence: rooms saved to a store are restored into a fresh
// RoomManager (simulating a server restart) with seats intact + tokens valid,
// and players marked disconnected awaiting reconnect. Uses a fake in-memory
// store + mock io, so no real Redis is needed.
import { RoomManager } from '../apps/server/src/rooms';
import type { PersistedRoom, RoomStore } from '../apps/server/src/store';

class FakeStore implements RoomStore {
  readonly enabled = true;
  private data = new Map<string, string>();
  async loadAll(): Promise<PersistedRoom[]> {
    return [...this.data.values()].map((v) => JSON.parse(v) as PersistedRoom);
  }
  save(code: string, room: PersistedRoom): void {
    this.data.set(code, JSON.stringify(room)); // JSON round-trip, like real Redis
  }
  remove(code: string): void {
    this.data.delete(code);
  }
}

// Minimal io stub — RoomManager only touches io.sockets.sockets.get for broadcasts.
const fakeIo = { sockets: { sockets: new Map() } } as any;

async function main() {
  const store = new FakeStore();

  // --- session 1: build a room, then "crash" ---
  const m1 = new RoomManager(fakeIo);
  await m1.useStore(store);
  const created = m1.create('Alice', 3, 'sainua');
  const j = m1.join(created.roomCode, 'Bob');
  const code = created.roomCode;

  // --- session 2: fresh manager, restore from the same store ---
  const m2 = new RoomManager(fakeIo);
  await m2.useStore(store);

  // Reconnect Alice (host) with her original token — proves seat + token survived.
  let reconnectOk = true;
  try {
    m2.attach({ id: 's-alice', join() {} } as any, code, created.playerId, created.token);
  } catch (e) {
    reconnectOk = false;
    console.error('reconnect failed:', e);
  }

  // Inspect the restored room via Bob's reconnect too.
  let bobOk = true;
  try {
    m2.attach({ id: 's-bob', join() {} } as any, code, j.playerId, j.token);
  } catch (e) {
    bobOk = false;
    console.error('bob reconnect failed:', e);
  }

  // A bogus token must still be rejected after restore.
  let badTokenRejected = false;
  try {
    m2.attach({ id: 's-x', join() {} } as any, code, created.playerId, 'WRONG');
  } catch {
    badTokenRejected = true;
  }

  console.log('room restored + host reconnected:', reconnectOk);
  console.log('second player reconnected:', bobOk);
  console.log('bad token rejected:', badTokenRejected);

  const ok = reconnectOk && bobOk && badTokenRejected;
  console.log(ok ? '\nPERSISTENCE TEST PASSED ✅' : '\nPERSISTENCE TEST FAILED ❌');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('PERSISTENCE TEST ERROR:', e);
  process.exit(1);
});
