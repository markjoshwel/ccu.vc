import { randomUUID } from 'node:crypto';

export type StoredAvatar = {
  data: Uint8Array;
  contentType: string;
  width: number;
  height: number;
};

export class AvatarStore {
  private store = new Map<string, StoredAvatar>();

  save(avatar: StoredAvatar): string {
    const id = randomUUID();
    this.store.set(id, avatar);
    return id;
  }

  get(id: string): StoredAvatar | undefined {
    return this.store.get(id);
  }
}
