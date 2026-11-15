import { connection } from "next/server";
import { isValidStake, NICKNAME_MAX, STAKE_DEFAULT } from "@/lib/game";
import { hashDeviceId, hashPassword, hashToken, newPlayerToken, newRoomCode } from "@/lib/server/crypto";
import { db } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { cleanupAbandonedRooms, cleanupExpiredRooms, T } from "@/lib/server/room";
import type { RoomListItem } from "@/lib/types";

// GET /api/rooms - public list of all live rooms (lobby and in-game, full ones too; expired rooms are cleaned up first).
// Loading the list ("Intră în cameră") also sweeps abandoned rooms: no member seen and no activity for 600 s (ROOM_ABANDONED_MS).
export async function GET() {
  await connection(); // always request-time, never prerendered at build
  return handle(async () => {
    await Promise.all([cleanupExpiredRooms(), cleanupAbandonedRooms()]);
    const { data, error } = await db()
      .from(T.rooms)
      .select(
        "code, name, stake, status, password_hash, seat_a, seat_b, last_activity_at, barbut_players!barbut_players_room_id_fkey(count)",
      )
      .order("last_activity_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const rooms: RoomListItem[] = (data ?? [])
      .map((r) => {
        const total = (r.barbut_players as unknown as { count: number }[])[0]?.count ?? 0;
        const seated = Number(Boolean(r.seat_a)) + Number(Boolean(r.seat_b));
        return {
          code: r.code,
          name: r.name,
          stake: r.stake,
          status: r.status,
          hasPassword: r.password_hash !== null,
          seated,
          spectators: Math.max(0, total - seated),
        };
      })
      ;
    return { rooms };
  });
}

// POST /api/rooms - create a room; the creator takes seat A and is host.
export async function POST(req: Request) {
  return handle(async () => {
    await cleanupExpiredRooms();
    const body = await readJson(req);
    const name = cleanText(body.name, "Numele camerei", 1, 40);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const stake = body.stake === undefined ? STAKE_DEFAULT : Number(body.stake);
    if (!isValidStake(stake)) fail(400, "Miza trebuie să fie între 1 și 1000.");

    let passwordHash: string | null = null;
    if (typeof body.password === "string" && body.password.length > 0) {
      if (body.password.length > 100) fail(400, "Parola e prea lungă.");
      passwordHash = await hashPassword(body.password);
    }

    let room: { id: string; code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !room; attempt++) {
      const { data, error } = await db()
        .from(T.rooms)
        .insert({ code: newRoomCode(), name, password_hash: passwordHash, stake })
        .select("id, code")
        .single();
      if (error && !isUniqueViolation(error)) throw error;
      room = data;
    }
    if (!room) fail(503, "Nu am putut genera un cod de cameră. Încearcă din nou.");

    const token = newPlayerToken();
    const { data: player, error: playerError } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: hashDeviceId(body.deviceId), is_host: true })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const { error: hostError } = await db()
      .from(T.rooms)
      .update({ host_player_id: player.id, seat_a: player.id })
      .eq("id", room.id);
    if (hostError) throw hostError;

    return { code: room.code, playerId: player.id, token };
  });
}
