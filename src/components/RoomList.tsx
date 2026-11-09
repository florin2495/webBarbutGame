"use client";

import { useCallback, useEffect, useState } from "react";
import { api, parseSession, readSessionRaw } from "@/lib/client/api";
import { MAX_SPECTATORS } from "@/lib/game";
import type { RoomListItem } from "@/lib/types";

const POLL_MS = 10_000;

/** Public list of all live rooms (lobby and in-game). Tap one to select it. */
export function RoomList({
  selected,
  onSelect,
  onRejoin,
}: {
  selected: string | null;
  onSelect: (room: RoomListItem) => void;
  onRejoin: (code: string) => void;
}) {
  const [rooms, setRooms] = useState<RoomListItem[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ rooms: RoomListItem[] }>("/api/rooms");
      setRooms(res.rooms);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kick = () => void load();
    const first = window.setTimeout(kick, 0);
    const interval = window.setInterval(kick, POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const refreshButton = (
    <button
      type="button"
      onClick={() => void load()}
      aria-label="Reîncarcă camerele"
      title="Reîncarcă camerele"
      className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={loading ? "animate-spin" : ""}
      >
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v5h-5" />
      </svg>
    </button>
  );

  let content;
  if (rooms === null) {
    content = <p className="py-4 text-center text-sm text-zinc-500">{error || "Caut camere…"}</p>;
  } else if (rooms.length === 0) {
    content = (
      <p className="py-4 text-center text-sm text-zinc-500">
        Nicio cameră deschisă acum. Creează una sau introdu un cod mai jos.
      </p>
    );
  } else {
    content = (
      <ul className="flex flex-col gap-2">
        {rooms.map((r) => {
          const mine = parseSession(readSessionRaw(r.code)) !== null;
          const active = selected === r.code;
          const canSit = r.seated < 2 && r.status !== "playing";
          const full = !canSit && r.spectators >= MAX_SPECTATORS;
          const playing = r.status === "playing";
          return (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => (mine ? onRejoin(r.code) : onSelect(r))}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {r.hasPassword && <span aria-label="cu parolă">🔒 </span>}
                    {r.name}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    <span
                      className={`mr-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        playing
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {playing ? "În joc" : "Lobby"}
                    </span>
                    miză {r.stake} · {r.seated}/2 la masă · {r.spectators}/{MAX_SPECTATORS} chibiți · {r.seated + r.spectators}{" "}
                    {r.seated + r.spectators === 1 ? "jucător" : "jucători"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-bold tracking-widest">{r.code}</span>
                  <span className="block text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400">
                    {mine ? "Reintră" : canSit ? "Joacă" : full ? "Plină" : "Privește"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-zinc-500">Camere</span>
        {refreshButton}
      </div>
      {content}
    </div>
  );
}
