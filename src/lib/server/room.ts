import "server-only";
import {
  isRoomAbandoned,
  isRoomExpired,
  PLAYING_IDLE_MINUTES,
  ROOM_ABANDONED_MS,
  ROOM_IDLE_MINUTES,
} from "@/lib/game";
import type { BetItem, PublicPlayer, RoomState, ThrowItem } from "@/lib/types";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, ROOM_COLUMNS, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";
import { enforceExpiredKicks } from "./kick";

export const T = {
  rooms: "barbut_rooms",
  players: "barbut_players",
  throws: "barbut_throws",
  bets: "barbut_bets",
} as const;

const GONE = "Camera nu mai există (a fost închisă după inactivitate).";

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every room idle for longer than its limit. */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const idle = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const playing = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const [a, b] = await Promise.all([
    db().from(T.rooms).delete().in("status", ["waiting", "finished"]).lt("last_activity_at", idle),
    db().from(T.rooms).delete().eq("status", "playing").lt("last_activity_at", playing),
  ]);
  if (a.error) console.error("cleanup failed", a.error);
  if (b.error) console.error("cleanup failed", b.error);
}

/**
 * Deletes rooms in ANY status (also "playing") with no activity for ROOM_ABANDONED_MS and no member (seated
 * player or spectator, both are barbut_players rows) seen within it (see isRoomAbandoned). Players, throws and
 * bets cascade. Best effort: a failure is logged, never thrown.
 */
export async function cleanupAbandonedRooms(): Promise<void> {
  const now = Date.now();
  const cutoff = new Date(now - ROOM_ABANDONED_MS).toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .select("id, last_activity_at, barbut_players!barbut_players_room_id_fkey(last_seen_at)")
    .lt("last_activity_at", cutoff)
    .limit(200);
  if (error) {
    console.error("abandoned cleanup (select) failed", error);
    return;
  }
  type Seen = { last_seen_at: string | null }[] | null;
  const ids = (data ?? [])
    .filter((r) => {
      const seen = ((r.barbut_players as unknown as Seen) ?? []).map((m) => m.last_seen_at);
      return isRoomAbandoned(r.last_activity_at as string, seen, now);
    })
    .map((r) => r.id as string);
  if (ids.length === 0) return;
  // Re-check the activity cutoff in the delete itself, so a room touched meanwhile survives.
  const { error: delError } = await db().from(T.rooms).delete().in("id", ids).lt("last_activity_at", cutoff);
  if (delError) console.error("abandoned cleanup (delete) failed", delError);
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  // Lazy enforcement of host kicks whose 10 s are over (may remove the caller -> 401 below).
  const room = await enforceExpiredKicks(await getRoomByCode(code), () => getRoomByCode(code));
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function isSeated(room: RoomRow, playerId: string): boolean {
  return room.seat_a === playerId || room.seat_b === playerId;
}

export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

export async function listThrows(roomId: string, round: number): Promise<ThrowItem[]> {
  const { data, error } = await db()
    .from(T.throws)
    .select("seq, player_id, d1, d2, outcome")
    .eq("room_id", roomId)
    .eq("round", round)
    .order("seq", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ seq: r.seq, playerId: r.player_id, d1: r.d1, d2: r.d2, outcome: r.outcome }));
}

export async function listBets(roomId: string, round: number): Promise<BetItem[]> {
  const { data, error } = await db()
    .from(T.bets)
    .select("id, player_id, kind, target_player_id, throw_seq, amount, status")
    .eq("room_id", roomId)
    .eq("round", round)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id,
    playerId: b.player_id,
    kind: b.kind,
    targetPlayerId: b.target_player_id,
    throwSeq: b.throw_seq,
    amount: b.amount,
    status: b.status,
  }));
}

/** Queued spectators (not seated), in queue order. */
export function queuedSpectatorIds(room: RoomRow, members: PlayerRow[]): string[] {
  return members
    .filter((p) => p.queued_at && !isSeated(room, p.id))
    .sort((a, b) => Date.parse(a.queued_at!) - Date.parse(b.queued_at!))
    .map((p) => p.id);
}

/** Adds `delta` chips to a player. Callers are serialized by the room's throw_count claim. */
export async function addBalance(playerId: string, delta: number): Promise<void> {
  if (delta === 0) return;
  const { data, error } = await db().from(T.players).select("balance").eq("id", playerId).maybeSingle();
  if (error) throw error;
  if (!data) return; // player left meanwhile
  const { error: upError } = await db()
    .from(T.players)
    .update({ balance: (data.balance as number) + delta })
    .eq("id", playerId);
  if (upError) throw upError;
}

/** Voids every open bet of a round (round cancelled, e.g. a player left mid-round). */
export async function voidOpenBets(roomId: string, round: number): Promise<void> {
  const { error } = await db()
    .from(T.bets)
    .update({ status: "void" })
    .eq("room_id", roomId)
    .eq("round", round)
    .eq("status", "open");
  if (error) throw error;
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const [players, throws, bets] = await Promise.all([
    listPlayers(room.id),
    room.round > 0 ? listThrows(room.id, room.round) : Promise.resolve([]),
    room.round > 0 ? listBets(room.id, room.round) : Promise.resolve([]),
  ]);

  const now = Date.now();
  const queue = players
    .filter((p) => p.queued_at && room.seat_a !== p.id && room.seat_b !== p.id)
    .sort((a, b) => Date.parse(a.queued_at!) - Date.parse(b.queued_at!))
    .map((p) => p.id);
  const toPublic = (p: PlayerRow): PublicPlayer => ({
    id: p.id,
    nickname: p.nickname,
    isHost: p.is_host,
    balance: p.balance,
    seat: room.seat_a === p.id ? "A" : room.seat_b === p.id ? "B" : null,
    kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
    connected: isConnected(p.last_seen_at, now),
    queuePosition: queue.includes(p.id) ? queue.indexOf(p.id) + 1 : null,
  });
  const rank = (p: PublicPlayer) =>
    p.seat === "A" ? 0 : p.seat === "B" ? 1 : p.queuePosition !== null ? 1 + p.queuePosition : 100;
  const ordered = players.map(toPublic).sort((a, b) => rank(a) - rank(b)); // stable: other spectators keep join order

  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      stake: room.stake,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      seatA: room.seat_a,
      seatB: room.seat_b,
      throwerPlayerId: room.thrower_player_id,
      winnerPlayerId: room.winner_player_id,
      throwCount: room.throw_count,
    },
    players: ordered,
    me: toPublic(me),
    throws,
    bets,
  };
}

/** Fresh state for the caller right after an action, so the client needs no follow-up /state request. */
export async function stateAfterAction(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  return buildState(await getRoomByCode(room.code), me);
}
