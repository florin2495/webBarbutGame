import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { isSeated, requireMember, touchRoom, T } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - a spectator toggles "Intră la runda următoare". At the next round the queued
// spectators take the free seats, in queue order (see /start); the others stay spectators.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (isSeated(room, player.id)) fail(409, "Ești deja la masă.");
    const queued = player.queued_at === null;
    const { error } = await db()
      .from(T.players)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue");
    return { queued };
  });
}
