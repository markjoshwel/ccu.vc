import { randomUUID } from 'node:crypto';

// Maximum number of avatars to store in memory
const MAX_AVATARS = 5000;

export type StoredAvatar = {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  roomCode?: string;
  lastAccessed: number;
};

export class AvatarStore {
  private store = new Map<string, StoredAvatar>();
  private roomAvatars = new Map<string, Set<string>>();

  save(avatar: Omit<StoredAvatar, 'lastAccessed'>): string {
    // Evict LRU avatars if at capacity
    while (this.store.size >= MAX_AVATARS) {
      this.evictLRU();
    }
    
    const id = randomUUID();
    this.store.set(id, { ...avatar, lastAccessed: Date.now() });
    
    if (avatar.roomCode) {
      let avatarIds = this.roomAvatars.get(avatar.roomCode);
      if (!avatarIds) {
        avatarIds = new Set();
        this.roomAvatars.set(avatar.roomCode, avatarIds);
      }
      avatarIds.add(id);
    }
    
    return id;
  }

  get(id: string): StoredAvatar | undefined {
    const avatar = this.store.get(id);
    if (avatar) {
      // Update last accessed time for LRU tracking
      avatar.lastAccessed = Date.now();
    }
    return avatar;
  }

  delete(id: string): boolean {
    const avatar = this.store.get(id);
    if (avatar && avatar.roomCode) {
      const avatarIds = this.roomAvatars.get(avatar.roomCode);
      if (avatarIds) {
        avatarIds.delete(id);
        if (avatarIds.size === 0) {
          this.roomAvatars.delete(avatar.roomCode);
        }
      }
    }
    return this.store.delete(id);
  }

  deleteByRoom(roomCode: string): number {
    const avatarIds = this.roomAvatars.get(roomCode);
    if (!avatarIds) return 0;
    
    let deleted = 0;
    for (const id of avatarIds) {
      if (this.store.delete(id)) {
        deleted++;
      }
    }
    this.roomAvatars.delete(roomCode);
    return deleted;
  }

  get size(): number {
    return this.store.size;
  }
  
  private evictLRU(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;
    
    for (const [id, avatar] of this.store) {
      if (avatar.lastAccessed < oldestTime) {
        oldestTime = avatar.lastAccessed;
        oldestId = id;
      }
    }
    
    if (oldestId) {
      this.delete(oldestId);
    }
  }
}
