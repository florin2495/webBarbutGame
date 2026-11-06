import "server-only";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow } from "./db";
import { listPlayers, T, voidOpenBets } from "./room";

/**
 * Removes a member from a room (used by "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to a seated player, else the oldest spectator
 *  - seated player removed: the round in progress is cancelled (open bets void) and the
 *    oldest spectator takes the free seat, so the table keeps going
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  const now = new Date().toISOString();
  const remaining = (await listPlayers(room.id)).filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  let seatA = room.seat_a === playerId ? null : room.seat_a;
  let seatB = room.seat_b === playerId ? null : room.seat_b;
  const update: Record<string, unknown> = { updated_at: now, last_activity_at: now };

  if (seatA !== room.seat_a || seatB !== room.seat_b) {
    const spectators = remaining.filter((p) => p.id !== seatA && p.id !== seatB);
    if (!seatA && spectators[0]) seatA = spectators.shift()!.id;
    if (!seatB && spectators[0]) seatB = spectators.shift()!.id;
    update.seat_a = seatA;
    update.seat_b = seatB;
    if (room.status === "playing") {
      await voidOpenBets(room.id, room.round);
      update.thrower_player_id = null;
    }
    update.status = room.status === "finished" && seatA && seatB ? "finished" : "waiting";
  }

  let newHostId = room.host_player_id;
  if (room.host_player_id === playerId) {
    newHostId = (remaining.find((p) => p.id === seatA || p.id === seatB) ?? remaining[0]).id;
    update.host_player_id = newHostId;
  }

  // Update the room first so no seat / host / thrower points at a deleted player.
  const { error: roomError } = await db().from(T.rooms).update(update).eq("id", room.id);
  if (roomError) throw roomError;

  if (newHostId !== room.host_player_id && newHostId) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  // Cascades to the member's bets; their throws stay (player_id -> null).
  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
