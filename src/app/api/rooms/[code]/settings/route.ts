import { isValidStake } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { stake } - host changes the stake between rounds.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    if (room.status === "playing") fail(409, "Miza se schimbă doar între mâini.");
    const body = await readJson(req);
    const stake = Number(body.stake);
    if (!isValidStake(stake)) fail(400, "Miza trebuie să fie între 1 și 1000.");
    const now = new Date().toISOString();
    const { error } = await db()
      .from(T.rooms)
      .update({ stake, updated_at: now, last_activity_at: now })
      .eq("id", room.id)
      .neq("status", "playing");
    if (error) throw error;
    await notifyRoom(room.id, "settings");
    return { ok: true };
  });
}
