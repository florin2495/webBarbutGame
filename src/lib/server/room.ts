import "server-only";
import { isRoomExpired, minutesLabel, PLAYING_IDLE_MINUTES, ROOM_IDLE_MINUTES } from "@/lib/game";
import type { BetItem, PublicPlayer, RoomState, ThrowItem } from "@/lib/types";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, ROOM_COLUMNS, type PlayerRow, type RoomRow } from "./db";
import { fail } from "./http";

export const T = {
  rooms: "barbut_rooms",
  players: "barbut_players",
  throws: "barbut_throws",
  bets: "barbut_bets",
} as const;

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

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

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  const room = await getRoomByCode(code);
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  return { room, player: data as PlayerRow };
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

  const toPublic = (p: PlayerRow): PublicPlayer => ({
    id: p.id,
    nickname: p.nickname,
    isHost: p.is_host,
    balance: p.balance,
    seat: room.seat_a === p.id ? "A" : room.seat_b === p.id ? "B" : null,
  });
  const rank = (p: PublicPlayer) => (p.seat === "A" ? 0 : p.seat === "B" ? 1 : 2);
  const ordered = players.map(toPublic).sort((a, b) => rank(a) - rank(b)); // stable: spectators keep join order

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
