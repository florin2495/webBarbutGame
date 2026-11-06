import { MAX_SPECTATORS } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { isSeated, listPlayers, requireMember, T } from "@/lib/server/room";

// POST /api/rooms/[code]/seat  { action: "sit" | "stand" } - between rounds only.
//  sit:   a spectator takes a free seat at the table
//  stand: a player leaves the table and watches (needs room among the spectators)
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/seat">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (room.status === "playing") fail(409, "Așteaptă să se termine mâna.");
    const body = await readJson(req);
    const now = new Date().toISOString();

    if (body.action === "sit") {
      if (isSeated(room, player.id)) fail(409, "Ești deja la masă.");
      const seat = !room.seat_a ? "seat_a" : !room.seat_b ? "seat_b" : null;
      if (!seat) fail(409, "Nu e niciun loc liber la masă.");
      const { data, error } = await db()
        .from(T.rooms)
        .update({ [seat]: player.id, status: "waiting", updated_at: now, last_activity_at: now })
        .eq("id", room.id)
        .is(seat, null)
        .neq("status", "playing")
        .select("id");
      if (error) throw error;
      if (!data?.length) fail(409, "Locul a fost ocupat între timp.");
    } else if (body.action === "stand") {
      if (!isSeated(room, player.id)) fail(409, "Nu ești la masă.");
      const members = await listPlayers(room.id);
      const spectators = members.filter((p) => !isSeated(room, p.id)).length;
      if (spectators >= MAX_SPECTATORS) fail(409, `Sunt deja ${MAX_SPECTATORS} spectatori.`);
      const seat = room.seat_a === player.id ? "seat_a" : "seat_b";
      const { data, error } = await db()
        .from(T.rooms)
        .update({ [seat]: null, status: "waiting", updated_at: now, last_activity_at: now })
        .eq("id", room.id)
        .eq(seat, player.id)
        .neq("status", "playing")
        .select("id");
      if (error) throw error;
      if (!data?.length) fail(409, "Mâna a început între timp.");
    } else {
      fail(400, "Acțiune necunoscută.");
    }

    await notifyRoom(room.id, "seat");
    return { ok: true };
  });
}
