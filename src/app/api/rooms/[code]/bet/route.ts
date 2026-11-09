import { notifyRoom } from "@/lib/server/broadcast";
import { db, ROOM_COLUMNS, type RoomRow } from "@/lib/server/db";
import { fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { isSeated, requireMember, stateAfterAction, T } from "@/lib/server/room";

// POST /api/rooms/[code]/bet  { kind: "braila", targetPlayerId } | { kind: "san" }
// Spectators only. Amount = the room stake.
//  - braila: on one of the two players, settled when the round ends (one per round)
//  - san: on the next throw of whoever holds the dice (one open at a time)
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/bet">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (isSeated(room, player.id)) fail(403, "Pariurile sunt pentru chibiții de pe margine.");
    if (room.status !== "playing" || !room.thrower_player_id) fail(409, "Pariezi doar cât se joacă o mână.");

    const body = await readJson(req);
    const kind = body.kind;
    let row: Record<string, unknown>;
    if (kind === "braila") {
      const target = typeof body.targetPlayerId === "string" ? body.targetPlayerId : "";
      if (target !== room.seat_a && target !== room.seat_b) fail(400, "Alege unul dintre cei doi jucători.");
      row = { kind, target_player_id: target, throw_seq: null };
    } else if (kind === "san") {
      row = { kind, target_player_id: room.thrower_player_id, throw_seq: room.throw_count + 1 };
    } else {
      fail(400, "Pariu necunoscut.");
    }

    const { data, error } = await db()
      .from(T.bets)
      .insert({ ...row, room_id: room.id, round: room.round, player_id: player.id, amount: room.stake })
      .select("id")
      .single();
    if (isUniqueViolation(error)) {
      fail(409, kind === "braila" ? "Ai pus deja Brăila în mâna asta." : "Ai deja un Șan pe aruncarea asta.");
    }
    if (error) throw error;

    // Re-check: the dice may have been thrown between our read and the insert. If so, withdraw
    // the bet - unless that throw already settled it, in which case it stands.
    const { data: now, error: reError } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("id", room.id).single();
    if (reError) throw reError;
    const fresh = now as RoomRow;
    const stale =
      fresh.round !== room.round ||
      (kind === "braila" && fresh.status !== "playing") ||
      (kind === "san" && fresh.throw_count !== room.throw_count);
    if (stale) {
      const { data: removed } = await db().from(T.bets).delete().eq("id", data.id).eq("status", "open").select("id");
      if (removed?.length) fail(409, "Zarurile au fost aruncate între timp. Mai încearcă.");
    }

    await notifyRoom(room.id, "bet");
    return { ok: true, state: await stateAfterAction(room, player) };
  });
}
