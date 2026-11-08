import { describe, expect, it } from "vitest";
import {
  betDelta,
  fillSeatsFromQueue,
  firstThrower,
  isPermutation,
  isRoomExpired,
  isValidStake,
  playerKey,
  roundWinner,
  settleBraila,
  settleSan,
  throwLabel,
  throwOutcome,
} from "./game";

describe("throwOutcome (barbut curat)", () => {
  it("wins on 6-6, 5-5, 3-3, 6-5 in any order", () => {
    for (const [a, b] of [[6, 6], [5, 5], [3, 3], [6, 5], [5, 6]]) expect(throwOutcome(a, b)).toBe("win");
  });
  it("loses on 1-1, 2-2, 4-4, 1-2 in any order", () => {
    for (const [a, b] of [[1, 1], [2, 2], [4, 4], [1, 2], [2, 1]]) expect(throwOutcome(a, b)).toBe("lose");
  });
  it("is fair: 5/36 win, 5/36 lose, 26/36 neutral", () => {
    const count = { win: 0, lose: 0, neutral: 0 };
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) count[throwOutcome(a, b)]++;
    expect(count).toEqual({ win: 5, lose: 5, neutral: 26 });
  });
});

describe("roundWinner", () => {
  it("thrower wins on win, opponent on lose, nobody on neutral", () => {
    expect(roundWinner("win", "a", "b")).toBe("a");
    expect(roundWinner("lose", "a", "b")).toBe("b");
    expect(roundWinner("neutral", "a", "b")).toBeNull();
  });
});

describe("bets", () => {
  it("Brăila follows the player it is on", () => {
    expect(settleBraila("a", "a")).toBe("won");
    expect(settleBraila("a", "b")).toBe("lost");
    expect(settleBraila("a", null)).toBe("void");
  });
  it("Șan is decided by one throw; neutral voids it", () => {
    expect(settleSan("win")).toBe("won");
    expect(settleSan("lose")).toBe("lost");
    expect(settleSan("neutral")).toBe("void");
  });
  it("moves chips", () => {
    expect(betDelta("won", 10)).toBe(10);
    expect(betDelta("lost", 10)).toBe(-10);
    expect(betDelta("void", 10)).toBe(0);
    expect(betDelta("open", 10)).toBe(0);
  });
});

describe("firstThrower", () => {
  it("seat A starts, then the last winner keeps the dice", () => {
    expect(firstThrower("a", "b", null)).toBe("a");
    expect(firstThrower("a", "b", "b")).toBe("b");
    expect(firstThrower("a", "b", "a")).toBe("a");
    expect(firstThrower("a", "b", "gone")).toBe("a");
  });
});

describe("misc", () => {
  it("labels throws", () => {
    expect(throwLabel(5, 6)).toBe("șase-cinci");
    expect(throwLabel(4, 4)).toBe("dublu 4");
  });
  it("validates stake", () => {
    expect(isValidStake(10)).toBe(true);
    expect(isValidStake(0)).toBe(false);
    expect(isValidStake(1001)).toBe(false);
    expect(isValidStake(2.5)).toBe(false);
  });
  it("expires idle rooms, playing ones later", () => {
    const now = Date.parse("2026-01-01T00:20:00Z");
    expect(isRoomExpired("waiting", "2026-01-01T00:05:00Z", now)).toBe(true);
    expect(isRoomExpired("waiting", "2026-01-01T00:11:00Z", now)).toBe(false);
    expect(isRoomExpired("playing", "2026-01-01T00:05:00Z", now)).toBe(false);
    expect(isRoomExpired("finished", "2026-01-01T00:15:00Z", now)).toBe(false);
  });
});

describe("fillSeatsFromQueue", () => {
  it("seats the queue in order and leaves the rest as spectators", () => {
    expect(fillSeatsFromQueue(null, null, ["x", "y", "z"])).toEqual({ seatA: "x", seatB: "y", seated: ["x", "y"] });
    expect(fillSeatsFromQueue("a", null, ["x", "y"])).toEqual({ seatA: "a", seatB: "x", seated: ["x"] });
  });
  it("does nothing when full or nobody queued", () => {
    expect(fillSeatsFromQueue("a", "b", ["x"]).seated).toEqual([]);
    expect(fillSeatsFromQueue(null, "b", []).seatA).toBeNull();
  });
});

describe("isPermutation / playerKey", () => {
  it("accepts only full permutations", () => {
    expect(isPermutation(["b", "a"], ["a", "b"])).toBe(true);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a", "c"], ["a", "b"])).toBe(false);
    expect(isPermutation("ab", ["a", "b"])).toBe(false);
  });
  it("lowercases and trims nicknames", () => {
    expect(playerKey("  Ion ")).toBe("ion");
  });
});
