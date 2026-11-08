import type { BetStatus, Outcome } from "./game";

export type RoomStatus = "waiting" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  balance: number;
  /** "A" / "B" when seated, null for a spectator. */
  seat: "A" | "B" | null;
  /** Ms left of a pending host kick (10 s to press "Ignoră"), null when none is pending. */
  kickRemainingMs: number | null;
  /** Seen in the last 45 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  /** 1-based place in the "Intră la runda următoare" queue, null when not queued. */
  queuePosition: number | null;
}

export interface ThrowItem {
  seq: number;
  playerId: string | null;
  d1: number;
  d2: number;
  outcome: Outcome;
}

export interface BetItem {
  id: number;
  playerId: string;
  kind: "braila" | "san";
  targetPlayerId: string | null;
  throwSeq: number | null;
  amount: number;
  status: BetStatus;
}

/** What GET /api/rooms/[code]/state returns to a member. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    stake: number;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    seatA: string | null;
    seatB: string | null;
    throwerPlayerId: string | null;
    winnerPlayerId: string | null;
    throwCount: number;
  };
  /** Seated players first (A, B), then queued spectators (queue order), then the other spectators in join order. */
  players: PublicPlayer[];
  me: PublicPlayer;
  /** Throws of the current (or just finished) round, oldest first. */
  throws: ThrowItem[];
  /** All bets of the current round (everyone sees them, like at a real table). */
  bets: BetItem[];
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  stake: number;
  status: RoomStatus;
  hasPassword: boolean;
  seated: number;
  spectators: number;
}

export interface Session {
  playerId: string;
  token: string;
}
