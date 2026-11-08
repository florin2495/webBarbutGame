import "server-only";
import { playerKey } from "@/lib/game";
import { db } from "./db";

const GAME = "barbut";

/**
 * Reports a finished round to the hub's shared leaderboard (tables owned by florin2495/hailataticu-hub,
 * migration 002_hub_leaderboard.sql). Idempotent per (game, room_code, round_no) through hub_leaderboard_rounds:
 * the first insert claims the round, a repeat hits the primary key and is skipped.
 * +1 games for every player, +1 wins for the winner. Best effort: never throws, a missing table or a
 * network error must not break the throw.
 */
export async function reportRound(
  roomCode: string,
  roundNo: number,
  players: { nickname: string; won: boolean }[],
): Promise<void> {
  try {
    const { error: claimError } = await db()
      .from("hub_leaderboard_rounds")
      .insert({ game: GAME, room_code: roomCode, round_no: roundNo });
    if (claimError) {
      if (claimError.code !== "23505") console.error("leaderboard claim failed", claimError);
      return;
    }
    for (const p of players) {
      const key = playerKey(p.nickname);
      if (!key) continue;
      const { data, error } = await db()
        .from("hub_leaderboard")
        .select("wins, games")
        .eq("game", GAME)
        .eq("player_key", key)
        .maybeSingle();
      if (error) throw error;
      const { error: upError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: key,
            display_name: p.nickname.trim().slice(0, 40),
            wins: (data?.wins ?? 0) + (p.won ? 1 : 0),
            games: (data?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upError) throw upError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
