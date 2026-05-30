import { useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { EV, type GameView } from '@slave/engine';

const SERVER_URL = import.meta.env.DEV ? 'http://localhost:3001' : '/';
export const socket: Socket = io(SERVER_URL, { autoConnect: true });

export interface Session {
  roomCode: string;
  playerId: string;
  token: string;
  name: string;
}

const KEY = 'slave.session';
const NAME_KEY = 'slave.name';

export function saveSession(s: Session): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  saveName(s.name);
}
export function loadSession(): Session | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Session) : null;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  localStorage.removeItem(KEY);
}

/** The player's display name persists across sessions / leaves / drops. */
export function saveName(name: string): void {
  if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
}
export function loadName(): string {
  return localStorage.getItem(NAME_KEY) ?? '';
}

export function emitAck<T>(event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

/** Subscribe to authoritative state + error pushes from the server. */
export function useGameView() {
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean>(socket.connected);

  useEffect(() => {
    // Reconcile immediately — the initial 'connect' may have fired before this
    // listener was attached (module-level socket, StrictMode remount), which
    // otherwise leaves the "reconnecting" banner stuck on.
    setConnected(socket.connected);
    const onState = (v: GameView) => setView(v);
    const onError = (e: { message: string }) => setError(e.message);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on(EV.state, onState);
    socket.on(EV.error, onError);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off(EV.state, onState);
      socket.off(EV.error, onError);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return { view, setView, error, setError, connected };
}
