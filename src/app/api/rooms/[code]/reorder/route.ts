import { isPermutation } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { isSeated, listPlayers, requireHost, requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, between rounds.
// `order` must be a full permutation of the room's members. In Barbut the order only decides who throws
// first: the two seated players take seat A / seat B in the order they appear, and the dice go to seat A
// (the previous winner no longer keeps them). Queued spectators are served in the order they appear.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    if (room.status === "playing") fail(409, "Ordinea se schimbă doar între mâini.");
    const body = await readJson(req);
    const members = await listPlayers(room.id);
    if (!isPermutation(body.order, members.map((p) => p.id))) fail(400, "Ordinea trebuie să conțină toți jucătorii, o singură dată.");
    const order = body.order as string[];

    const seated = order.filter((id) => isSeated(room, id));
    const now = new Date().toISOString();
    const { data, error } = await db()
      .from(T.rooms)
      .update({
        seat_a: seated[0] ?? null,
        seat_b: seated[1] ?? null,
        winner_player_id: null,
        updated_at: now,
        last_activity_at: now,
      })
      .eq("id", room.id)
      .neq("status", "playing")
      .eq("round", room.round)
      .select("id");
    if (error) throw error;
    if (!data?.length) fail(409, "Mâna a început între timp.");

    // Queue order follows `order`: re-stamp the queued spectators 1 ms apart.
    const base = Date.now();
    const queued = order.filter((id) => members.find((m) => m.id === id)?.queued_at && !isSeated(room, id));
    for (const [i, id] of queued.entries()) {
      const { error: qError } = await db()
        .from(T.players)
        .update({ queued_at: new Date(base + i).toISOString() })
        .eq("id", id);
      if (qError) throw qError;
    }

    await notifyRoom(room.id, "reorder");
    return { ok: true };
  });
}
