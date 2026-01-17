// Local storage keys
const STORAGE_PREFIX = 'ccu_';

export interface StoredSession {
  roomCode: string;
  playerId: string;
  playerSecret: string;
}

export function getStoredSession(): StoredSession | null {
  try {
    const data = localStorage.getItem(`${STORAGE_PREFIX}session`);
    if (!data) return null;
    return JSON.parse(data) as StoredSession;
  } catch {
    return null;
  }
}

export function storeSession(session: StoredSession): void {
  localStorage.setItem(`${STORAGE_PREFIX}session`, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(`${STORAGE_PREFIX}session`);
}
