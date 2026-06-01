// Launches the game server for the preview with a very long turn timeout, so a
// seeded game stays frozen on the current turn while screenshots are taken.
// PORT is left to whatever the preview harness injects.
process.env.TURN_TIMEOUT_MS = process.env.TURN_TIMEOUT_MS ?? '3600000';
process.env.NEXT_ROUND_AUTO_MS = process.env.NEXT_ROUND_AUTO_MS ?? '3600000';
await import('../apps/server/src/index.ts');
