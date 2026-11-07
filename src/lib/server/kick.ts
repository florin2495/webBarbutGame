import "server-only";
import { isKickExpired, KICK_GRACE_MS, KICK_NETWORK_GRACE_MS } from "@/lib/kick";
import { db, type RoomRow } from "./db";
import { removePlayer } from "./membership";
import { T } from "./room";

/** Clears every pending kick of a room (a new round starts). */
export async function clearPendingKicks(roomId: string): Promise<void> {
  const { error } = await db()
    .from(T.players)
    .update({ kick_requested_at: null })
    .eq("room_id", roomId)
    .not("kick_requested_at", "is", null);
  if (error) throw error;
}

/**
 * Serverless = no timers, so host kicks whose grace is over are enforced lazily by whoever touches the room.
 * Each removal is claimed atomically (kick_requested_at is set back to null only if it still holds the value we
 * read), so concurrent requests never remove the same player twice. Returns the up-to-date room.
 * `reload` re-reads the room (it throws 404 if the last member was removed and the room closed).
 */
export async function enforceExpiredKicks(room: RoomRow, reload: () => Promise<RoomRow>): Promise<RoomRow> {
  const cutoff = new Date(Date.now() - (KICK_GRACE_MS + KICK_NETWORK_GRACE_MS)).toISOString();
  const { data, error } = await db()
    .from(T.players)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .lt("kick_requested_at", cutoff);
  if (error) throw error;

  let current = room;
  for (const row of data ?? []) {
    const requestedAt = row.kick_requested_at as string;
    if (!isKickExpired(requestedAt)) continue;
    const { data: claimed, error: claimError } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", row.id)
      .eq("kick_requested_at", requestedAt)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) continue; // someone else is removing them
    await removePlayer(current, row.id as string, "player_kicked");
    current = await reload();
  }
  return current;
}
