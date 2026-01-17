import { describe, expect, test, beforeEach } from 'bun:test';
import { RoomManager, generateRoomCode, generatePlayerId, generatePlayerSecret } from '../RoomManager';
import type { PlayerPrivate } from '@ccu/shared';

describe('generateRoomCode', () => {
  test('generates a 6 character code', () => {
    const code = generateRoomCode();
    expect(code.length).toBe(6);
  });

  test('code contains only A-Z (excluding I, O) and 2-9 (excluding 0, 1)', () => {
    const validChars = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(validChars);
    }
  });
});

describe('RoomManager', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  describe('createRoom', () => {
    test('creates a room with a valid short code', () => {
      const hostPlayerId = generatePlayerId();
      const room = manager.createRoom(hostPlayerId);
      
      expect(room.roomCode.length).toBe(6);
      expect(room.roomCode).toMatch(/^[A-Z0-9]+$/);
      expect(room.hostPlayerId).toBe(hostPlayerId);
      expect(room.phase).toBe('lobby');
    });

    test('room is stored and retrievable', () => {
      const hostPlayerId = generatePlayerId();
      const room = manager.createRoom(hostPlayerId);
      
      expect(manager.hasRoom(room.roomCode)).toBe(true);
      expect(manager.getRoom(room.roomCode)).toBe(room);
    });

    test('generates unique room codes', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const room = manager.createRoom(generatePlayerId());
        codes.add(room.roomCode);
      }
      expect(codes.size).toBe(50);
    });
  });

  describe('player management', () => {
    test('can add a player to a room', () => {
      const room = manager.createRoom(generatePlayerId());
      const player: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: generatePlayerSecret(),
        displayName: 'Test Player',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };

      const added = manager.addPlayer(room.roomCode, player);
      expect(added).toBe(true);
      expect(room.players.length).toBe(1);
      expect(room.players[0].playerId).toBe(player.playerId);
    });

    test('cannot add player to non-existent room', () => {
      const player: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: generatePlayerSecret(),
        displayName: 'Test',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };

      const added = manager.addPlayer('NONEXISTENT', player);
      expect(added).toBe(false);
    });
  });

  describe('deletion on zero connected', () => {
    test('room is deleted when connected count transitions to 0', () => {
      const room = manager.createRoom(generatePlayerId());
      const player1: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: generatePlayerSecret(),
        displayName: 'Player 1',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };
      const player2: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: generatePlayerSecret(),
        displayName: 'Player 2',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };

      manager.addPlayer(room.roomCode, player1);
      manager.addPlayer(room.roomCode, player2);

      expect(manager.getConnectedCount(room)).toBe(2);
      expect(manager.hasRoom(room.roomCode)).toBe(true);

      // Disconnect player 1
      manager.markPlayerDisconnected(room.roomCode, player1.playerId);
      expect(manager.getConnectedCount(room)).toBe(1);
      
      // Room should still exist with 1 connected
      const deleted1 = manager.checkAndCleanupRoom(room.roomCode);
      expect(deleted1).toBe(false);
      expect(manager.hasRoom(room.roomCode)).toBe(true);

      // Disconnect player 2
      manager.markPlayerDisconnected(room.roomCode, player2.playerId);
      expect(manager.getConnectedCount(room)).toBe(0);

      // Room should be deleted now
      const deleted2 = manager.checkAndCleanupRoom(room.roomCode);
      expect(deleted2).toBe(true);
      expect(manager.hasRoom(room.roomCode)).toBe(false);
    });

    test('empty room (no players yet) is deleted on cleanup', () => {
      const room = manager.createRoom(generatePlayerId());
      expect(manager.hasRoom(room.roomCode)).toBe(true);
      expect(manager.getConnectedCount(room)).toBe(0);

      const deleted = manager.checkAndCleanupRoom(room.roomCode);
      expect(deleted).toBe(true);
      expect(manager.hasRoom(room.roomCode)).toBe(false);
    });
  });

  describe('findPlayerBySecret', () => {
    test('finds player with correct secret', () => {
      const room = manager.createRoom(generatePlayerId());
      const secret = generatePlayerSecret();
      const player: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: secret,
        displayName: 'Test',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };

      manager.addPlayer(room.roomCode, player);

      const found = manager.findPlayerBySecret(room.roomCode, secret);
      expect(found).toBe(player);
    });

    test('returns undefined for wrong secret', () => {
      const room = manager.createRoom(generatePlayerId());
      const player: PlayerPrivate = {
        playerId: generatePlayerId(),
        playerSecret: generatePlayerSecret(),
        displayName: 'Test',
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: 60000
      };

      manager.addPlayer(room.roomCode, player);

      const found = manager.findPlayerBySecret(room.roomCode, 'wrong-secret');
      expect(found).toBeUndefined();
    });
  });
});
