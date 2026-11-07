import { MAX_SPECTATORS, NICKNAME_MAX } from "@/lib/game";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { enforceExpiredKicks } from "@/lib/server/kick";
import { getRoomByCode, listPlayers, T, touchRoom } from "@/lib/server/room";

interface SeatRow {
  id: string;
  nickname: string;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, spectate?, deviceId? }
// Takes a free seat when there is one (and no round is running), otherwise joins as a spectator.
// Spectators may join at any time, even mid-round.
// A nickname that is already in the room reclaims that member (same player id, new token) when the request
// comes from the same device or the member has been disconnected for 45 s - also mid-round. The member keeps
// its seat (or stays a spectator), balance and bets; `spectate` is ignored for a reclaim.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const wantsToWatch = body.spectate === true;
    const deviceHash = hashDeviceId(body.deviceId);
    // Enforce host kicks whose 10 s are over first, so a reclaim cannot undo an expired kick.
    const room = await enforceExpiredKicks(await getRoomByCode(code), () => getRoomByCode(code));

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: seats, error: seatsError } = await db()
      .from(T.players)
      .select("id, nickname, token_hash, device_hash, last_seen_at")
      .eq("room_id", room.id);
    if (seatsError) throw seatsError;
    const existing = ((seats ?? []) as SeatRow[]).find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token };
    }

    const members = await listPlayers(room.id);
    const seated = members.filter((p) => p.id === room.seat_a || p.id === room.seat_b).length;
    const spectators = members.length - seated;
    const freeSeat: "seat_a" | "seat_b" | null = !room.seat_a ? "seat_a" : !room.seat_b ? "seat_b" : null;
    const takeSeat = !wantsToWatch && freeSeat !== null && room.status !== "playing";
    if (!takeSeat && spectators >= MAX_SPECTATORS) {
      fail(409, `Camera e plină (2 jucători și maxim ${MAX_SPECTATORS} spectatori).`);
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: deviceHash })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    const now = new Date().toISOString();
    if (takeSeat && freeSeat) {
      // Conditional update: two people racing for the last seat - the loser stays a spectator.
      await db()
        .from(T.rooms)
        .update({ [freeSeat]: data.id, updated_at: now, last_activity_at: now })
        .eq("id", room.id)
        .is(freeSeat, null);
    } else {
      await db().from(T.rooms).update({ last_activity_at: now }).eq("id", room.id);
    }

    await notifyRoom(room.id, "player_joined");
    return { code: room.code, playerId: data.id, token };
  });
}
