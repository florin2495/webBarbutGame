import { isKickExpired } from "@/lib/kick";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/kick/ignore - the player with a pending host kick refuses it and stays.
// requireMember already removed anyone whose grace is over (they get 401), so 409 only covers the race.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick/ignore">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (!player.kick_requested_at) return { ok: true }; // nothing pending (already ignored)
    if (isKickExpired(player.kick_requested_at)) fail(409, "Prea târziu, ai fost scos.");

    const { data, error } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", player.id)
      .eq("kick_requested_at", player.kick_requested_at)
      .select("id");
    if (error) throw error;
    if (data?.length) await notifyRoom(room.id, "kick_ignored");
    return { ok: true };
  });
}
