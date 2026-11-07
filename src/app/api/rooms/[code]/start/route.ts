import { firstThrower } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { clearPendingKicks } from "@/lib/server/kick";
import { isSeated, requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/start - one of the two seated players starts a new round ("mână").
// Whoever won the last round keeps the dice and throws first.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (!isSeated(room, player.id)) fail(403, "Doar cei doi jucători de la masă pot porni mâna.");
    if (room.status === "playing") fail(409, "Mâna e deja în desfășurare.");
    if (!room.seat_a || !room.seat_b) fail(409, "Așteaptă al doilea jucător.");

    const now = new Date().toISOString();
    const { data, error } = await db()
      .from(T.rooms)
      .update({
        status: "playing",
        round: room.round + 1,
        throw_count: 0,
        thrower_player_id: firstThrower(room.seat_a, room.seat_b, room.winner_player_id),
        winner_player_id: null,
        updated_at: now,
        last_activity_at: now,
      })
      .eq("id", room.id)
      .eq("round", room.round)
      .neq("status", "playing")
      .select("id");
    if (error) throw error;
    if (!data?.length) fail(409, "Mâna a fost deja pornită.");

    await clearPendingKicks(room.id);
    await notifyRoom(room.id, "round_started");
    return { ok: true };
  });
}
