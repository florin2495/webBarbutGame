import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_ABANDONED_MS } from "@/lib/game";
import { cleanupAbandonedRooms } from "./room";

// vi.mock calls are hoisted above the imports, so ./room loads with the mocked db.
// cleanupAbandonedRooms with the Supabase client mocked: each db().from(...) call takes the next queued result
// and records the chained calls (select / lt / in / delete ...), so the test can check what was asked for.
type Result = { data?: unknown; error: unknown };
type Call = { op: string; args: unknown[] };

const h = vi.hoisted(() => {
  const queries: { table: string; calls: Call[] }[] = [];
  const results: Result[] = [];
  const from = (table: string) => {
    const q = { table, calls: [] as Call[] };
    queries.push(q);
    const result = results.shift() ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "delete", "update", "insert", "in", "lt", "eq", "limit", "order", "maybeSingle"]) {
      chain[op] = (...args: unknown[]) => {
        q.calls.push({ op, args });
        return chain;
      };
    }
    chain.then = (onOk: (r: Result) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onOk, onErr);
    return chain;
  };
  return { queries, results, from };
});

vi.mock("server-only", () => ({}));
vi.mock("./kick", () => ({ enforceExpiredKicks: vi.fn() }));
vi.mock("./db", () => ({ db: () => ({ from: h.from }), PLAYER_COLUMNS: "*", ROOM_COLUMNS: "*" }));

const NOW = Date.parse("2026-11-14T12:00:00.000Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const CUTOFF = new Date(NOW - ROOM_ABANDONED_MS).toISOString();
const room = (id: string, lastActivitySec: number, seenSec: (number | null)[]) => ({
  id,
  last_activity_at: ago(lastActivitySec),
  barbut_players: seenSec.map((s) => ({ last_seen_at: s === null ? null : ago(s) })),
});
const op = (q: { calls: Call[] }, name: string) => q.calls.find((c) => c.op === name);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.queries.length = 0;
  h.results.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("cleanupAbandonedRooms", () => {
  it("selects only rooms idle past the cutoff and deletes the silent ones, keeping rooms with a recent member", async () => {
    h.results.push(
      {
        data: [
          room("silent", 700, [900, 650]), // nobody seen within 600 s -> deleted
          room("empty", 601, []), // no members at all -> deleted
          room("nullSeen", 601, [null]), // never seen -> deleted
          room("watched", 700, [900, 30]), // a member (player or spectator) seen 30 s ago -> kept
          room("almost", 700, [599]), // seen 599 s ago -> kept
        ],
        error: null,
      },
      { error: null },
    );
    await cleanupAbandonedRooms();

    expect(h.queries).toHaveLength(2);
    const [select, del] = h.queries;
    expect(select.table).toBe("barbut_rooms");
    expect(op(select, "lt")?.args).toEqual(["last_activity_at", CUTOFF]);
    expect(del.table).toBe("barbut_rooms");
    expect(op(del, "delete")).toBeDefined();
    expect(op(del, "in")?.args).toEqual(["id", ["silent", "empty", "nullSeen"]]);
  });

  it("re-checks the activity cutoff in the delete, so a room touched meanwhile survives", async () => {
    h.results.push({ data: [room("silent", 700, [])], error: null }, { error: null });
    await cleanupAbandonedRooms();
    const del = h.queries[1];
    expect(op(del, "lt")?.args).toEqual(["last_activity_at", CUTOFF]);
  });

  it("deletes nothing when every idle room still has a recent member", async () => {
    h.results.push({ data: [room("watched", 1200, [10])], error: null });
    await cleanupAbandonedRooms();
    expect(h.queries).toHaveLength(1);
  });

  it("logs a select error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.results.push({ data: null, error: { message: "boom" } });
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    expect(h.queries).toHaveLength(1); // no delete attempted
  });

  it("logs a delete error instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.results.push({ data: [room("silent", 700, [])], error: null }, { error: { message: "boom" } });
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
  });
});
