// Pure game rules - shared by server and client, no I/O.

export const NICKNAME_MAX = 10;
export const SEATS = 2;
export const MAX_SPECTATORS = 5;
export const STAKE_MIN = 1;
export const STAKE_MAX = 1000;
export const STAKE_DEFAULT = 10;
export const STAKE_OPTIONS = [5, 10, 25, 50, 100] as const;

/**
 * Waiting/finished rooms are closed after this long without activity. Every open room page polls
 * /state, which refreshes the timer (see PRESENCE_TOUCH_MS), so a room only closes once nobody has it open.
 */
export const ROOM_IDLE_MINUTES = 2;
/** A round in progress that nobody has open is closed after this long. */
export const PLAYING_IDLE_MINUTES = 30;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

/** "2 minute" / "30 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  const limit = status === "playing" ? PLAYING_IDLE_MINUTES : ROOM_IDLE_MINUTES;
  return idle > limit * 60_000;
}

export function isValidStake(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= STAKE_MIN && (n as number) <= STAKE_MAX;
}

export type Outcome = "win" | "lose" | "neutral";

/**
 * "Barbut curat": the thrower wins on 6-6, 5-5, 3-3, 6-5 and loses on 1-1, 2-2, 4-4, 1-2.
 * Anything else is neutral and the dice pass to the opponent. 5/36 each way, so it is a fair game.
 */
export function throwOutcome(d1: number, d2: number): Outcome {
  const [lo, hi] = d1 <= d2 ? [d1, d2] : [d2, d1];
  const key = `${lo}-${hi}`;
  if (key === "6-6" || key === "5-5" || key === "3-3" || key === "5-6") return "win";
  if (key === "1-1" || key === "2-2" || key === "4-4" || key === "1-2") return "lose";
  return "neutral";
}

/** Short Romanian name of a throw, e.g. "șase-cinci", "dublu 4". */
export function throwLabel(d1: number, d2: number): string {
  const names = ["", "unu", "doi", "trei", "patru", "cinci", "șase"];
  if (d1 === d2) return d1 === 1 ? "dublu unu" : `dublu ${d1}`;
  const [hi, lo] = d1 >= d2 ? [d1, d2] : [d2, d1];
  return `${names[hi]}-${names[lo]}`;
}

/**
 * Result of a throw for the two players: who won the round (if any).
 * `throwerId` threw; `otherId` is the opponent.
 */
export function roundWinner(outcome: Outcome, throwerId: string, otherId: string): string | null {
  if (outcome === "win") return throwerId;
  if (outcome === "lose") return otherId;
  return null;
}

export type BetStatus = "open" | "won" | "lost" | "void";

/** Brăila: on a player, settled when the round ends. Void if the round ended without a winner. */
export function settleBraila(targetId: string | null, winnerId: string | null): BetStatus {
  if (!winnerId || !targetId) return "void";
  return targetId === winnerId ? "won" : "lost";
}

/**
 * Șan: on the thrower's next throw only ("pe mâna lui", the opponent's dice do not matter).
 * Win -> won, lose -> lost, neutral -> void (stake back).
 */
export function settleSan(outcome: Outcome): BetStatus {
  if (outcome === "win") return "won";
  if (outcome === "lose") return "lost";
  return "void";
}

/** Chips a settled bet moves for the bettor. */
export function betDelta(status: BetStatus, amount: number): number {
  if (status === "won") return amount;
  if (status === "lost") return -amount;
  return 0;
}

/** Whoever won the last round keeps the dice; round 1 starts with seat A. */
export function firstThrower(seatA: string, seatB: string, lastWinner: string | null): string {
  return lastWinner === seatB ? seatB : seatA;
}
