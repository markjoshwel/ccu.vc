import { randomUUID } from 'node:crypto';

export type StoredAvatar = {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
  roomCode?: string;
};

export class AvatarStore {
  private store = new Map<string, StoredAvatar>();
  private roomAvatars = new Map<string, Set<string>>();

  save(avatar: StoredAvatar): string {
    const id = randomUUID();
    this.store.set(id, avatar);
    
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
    return this.store.get(id);
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
}
