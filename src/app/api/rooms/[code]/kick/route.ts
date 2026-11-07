import { db } from "@/lib/server/db";
import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle, readJson } from "@/lib/server/http";
import { removePlayer } from "@/lib/server/membership";
import { isSeated, requireHost, requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/kick  { playerId } - host removes another member (player or spectator).
// Not a ban: identity is a browser token. A room password is the real access control.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);

    const body = await readJson(req);
    const targetId = typeof body.playerId === "string" ? body.playerId : "";
    if (targetId === player.id) fail(400, "Nu te poți scoate singur. Folosește „Părăsește camera”.");

    const { data: target, error } = await db()
      .from(T.players)
      .select("id")
      .eq("id", targetId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error; // 22P02 = malformed uuid
    if (!target) fail(404, "Jucătorul nu mai e în cameră.");

    // A seated player in a running round gets 10 s to refuse ("Ignoră"); chibiți and everyone
    // outside a running round are removed at once. The removal itself is enforced lazily (see kick.ts).
    if (room.status === "playing" && isSeated(room, targetId)) {
      const { error: pendError } = await db()
        .from(T.players)
        .update({ kick_requested_at: new Date().toISOString() })
        .eq("id", targetId)
        .is("kick_requested_at", null);
      if (pendError) throw pendError;
      await notifyRoom(room.id, "kick_pending");
      return { ok: true, pending: true };
    }

    await removePlayer(room, targetId, "player_kicked");
    return { ok: true };
  });
}
