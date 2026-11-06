import { MAX_SPECTATORS, NICKNAME_MAX } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, listPlayers, T } from "@/lib/server/room";

// POST /api/rooms/[code]/join  { nickname, password?, spectate? }
// Takes a free seat when there is one (and no round is running), otherwise joins as a spectator.
// Spectators may join at any time, even mid-round.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const wantsToWatch = body.spectate === true;
    const room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
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
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token) })
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
