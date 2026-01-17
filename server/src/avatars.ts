import { nanoid } from 'nanoid';

// Simple avatar system using generated color avatars
// For MVP, we generate avatars based on color and initials rather than full image upload

// Avatar storage (in-memory for MVP)
const avatars = new Map<string, AvatarData>();

export interface AvatarData {
  id: string;
  color: string;
  initials: string;
  createdAt: number;
}

// Generate a random color for avatars
function generateColor(): string {
  const hue = Math.floor(Math.random() * 360);
  return `hsl(${hue}, 70%, 50%)`;
}

// Generate initials from display name
function generateInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

/**
 * Create an avatar for a player
 */
export function createAvatar(displayName: string): string {
  const id = nanoid(12);
  const avatar: AvatarData = {
    id,
    color: generateColor(),
    initials: generateInitials(displayName),
    createdAt: Date.now()
  };
  avatars.set(id, avatar);
  return id;
}

/**
 * Get avatar data by ID
 */
export function getAvatar(id: string): AvatarData | undefined {
  return avatars.get(id);
}

/**
 * Generate an SVG avatar
 */
export function generateAvatarSvg(avatarId: string): string {
  const avatar = avatars.get(avatarId);
  if (!avatar) {
    // Return a default avatar
    return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="#ccc"/>
      <text x="32" y="40" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">?</text>
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="${avatar.color}"/>
    <text x="32" y="40" font-family="sans-serif" font-size="24" fill="white" text-anchor="middle">${avatar.initials}</text>
  </svg>`;
}

/**
 * Delete old avatars (cleanup)
 */
export function cleanupOldAvatars(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  const now = Date.now();
  for (const [id, avatar] of avatars) {
    if (now - avatar.createdAt > maxAgeMs) {
      avatars.delete(id);
    }
  }
}
