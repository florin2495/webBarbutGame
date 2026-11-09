import { randomInt } from "node:crypto";
import { betDelta, roundWinner, settleBraila, settleSan, throwOutcome, type BetStatus } from "@/lib/game";
import { notifyRoom } from "@/lib/server/broadcast";
import { db } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { reportRound } from "@/lib/server/leaderboard";
import { addBalance, requireMember, stateAfterAction, T } from "@/lib/server/room";

// POST /api/rooms/[code]/throw - the player holding the dice throws. Dice are rolled on the server.
//  - win/lose throw: the round ends, the stake moves, Brăila bets are settled
//  - neutral throw: the dice pass to the opponent
// Șan bets on this throw are settled either way.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/throw">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (room.status !== "playing") fail(409, "Nu e nicio mână în desfășurare.");
    if (room.thrower_player_id !== player.id) fail(409, "Nu ai tu zarurile.");
    const other = room.seat_a === player.id ? room.seat_b : room.seat_a;
    if (!other) fail(409, "Lipsește adversarul.");

    const d1 = randomInt(1, 7);
    const d2 = randomInt(1, 7);
    const outcome = throwOutcome(d1, d2);
    const winner = roundWinner(outcome, player.id, other);
    const seq = room.throw_count + 1;
    const now = new Date().toISOString();

    // Claim this throw slot atomically: a double tap or a second tab gets 0 rows and a 409.
    const { data: claimed, error: claimError } = await db()
      .from(T.rooms)
      .update({
        throw_count: seq,
        thrower_player_id: winner ? player.id : other,
        status: winner ? "finished" : "playing",
        winner_player_id: winner,
        updated_at: now,
        last_activity_at: now,
      })
      .eq("id", room.id)
      .eq("round", room.round)
      .eq("throw_count", room.throw_count)
      .eq("status", "playing")
      .eq("thrower_player_id", player.id)
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) fail(409, "Zarurile au fost deja aruncate.");

    const { error: throwError } = await db()
      .from(T.throws)
      .insert({ room_id: room.id, round: room.round, seq, player_id: player.id, d1, d2, outcome });
    if (throwError) throw throwError;

    // Settle bets. Only one request can reach this point per throw slot, so balances are not raced.
    const { data: open, error: betsError } = await db()
      .from(T.bets)
      .select("id, player_id, kind, target_player_id, throw_seq, amount")
      .eq("room_id", room.id)
      .eq("round", room.round)
      .eq("status", "open");
    if (betsError) throw betsError;

    const deltas = new Map<string, number>();
    const add = (id: string, d: number) => deltas.set(id, (deltas.get(id) ?? 0) + d);
    for (const bet of open ?? []) {
      let status: BetStatus | null = null;
      if (bet.kind === "san") status = bet.throw_seq === seq ? settleSan(outcome) : "void";
      else if (winner) status = settleBraila(bet.target_player_id, winner);
      if (!status) continue;
      const { data: done, error } = await db()
        .from(T.bets)
        .update({ status })
        .eq("id", bet.id)
        .eq("status", "open")
        .select("id");
      if (error) throw error;
      if (done?.length) add(bet.player_id, betDelta(status, bet.amount));
    }
    if (winner) {
      add(winner, room.stake);
      add(winner === player.id ? other : player.id, -room.stake);
    }
    for (const [id, delta] of deltas) await addBalance(id, delta);

    if (winner) {
      // Round over: report to the hub leaderboard (best effort, see lib/server/leaderboard.ts).
      const { data: rows } = await db().from(T.players).select("id, nickname").in("id", [player.id, other]);
      await reportRound(
        room.code,
        room.round,
        (rows ?? []).map((r) => ({ nickname: r.nickname as string, won: r.id === winner })),
      );
    }

    await notifyRoom(room.id, "throw");
    return { d1, d2, outcome, state: await stateAfterAction(room, player) };
  });
}
