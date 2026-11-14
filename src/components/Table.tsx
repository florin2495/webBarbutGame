"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useKickSeconds } from "@/lib/client/countdown";
import { PREF_ANIMATION, PREF_SOUND, useBoolPref } from "@/lib/client/prefs";
import { playRattle, unlockAudio } from "@/lib/client/sound";
import { MAX_SPECTATORS, STAKE_OPTIONS, throwLabel } from "@/lib/game";
import type { BetItem, PublicPlayer, RoomState, ThrowItem } from "@/lib/types";
import { Die } from "./Dice";
import { Rules } from "./Home";
import { Button, Card, ErrorText } from "./ui";

const ROLL_MS = 650;

interface Props {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  /** Applies a state returned by an action, saving the follow-up /state request. */
  applyState?: (s: RoomState) => void;
  /** When the state was fetched (ms epoch), for local countdowns. */
  receivedAt: number;
}

/** Runs an API action with a busy flag and a user-facing error. */
function useAction(token: string, refresh: () => Promise<void>, applyState?: (s: RoomState) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function run(key: string, path: string, body: unknown = {}) {
    setBusy(key);
    setError("");
    try {
      const res = await api<{ state?: RoomState } | null>(path, { token, body });
      // Actions that return the new state (throw, start, bet) need no /state afterwards.
      if (res?.state && applyState) applyState(res.state);
      else await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

export function Table({ state, token, refresh, applyState, receivedAt }: Props) {
  const { room, me, players, throws } = state;
  const { busy, error, run } = useAction(token, refresh, applyState);
  const nick = new Map(players.map((p) => [p.id, p.nickname]));
  const seatA = players.find((p) => p.seat === "A") ?? null;
  const seatB = players.find((p) => p.seat === "B") ?? null;
  const last = throws.at(-1) ?? null;
  const rolling = useRolling(last);
  const isSpectator = me.seat === null;
  const iThrow = room.status === "playing" && room.throwerPlayerId === me.id;
  const path = (a: string) => `/api/rooms/${room.code}/${a}`;

  return (
    <>
      <Card className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <SeatCard player={seatA} state={state} testId="seat-a" />
          <SeatCard player={seatB} state={state} testId="seat-b" />
        </div>

        <DiceArea last={last} rolling={rolling} nick={nick} state={state} />

        {room.status === "playing" ? (
          iThrow ? (
            <Button
              className="min-h-14 text-lg"
              data-testid="throw-button"
              disabled={busy !== null || rolling}
              onClick={() => {
                unlockAudio();
                void run("throw", path("throw"));
              }}
            >
              {busy === "throw" ? "Se aruncă…" : "🎲 Aruncă zarurile"}
            </Button>
          ) : (
            <p className="rounded-lg bg-zinc-100 py-3 text-center text-sm font-semibold dark:bg-zinc-900" data-testid="turn-info">
              Aruncă {nick.get(room.throwerPlayerId ?? "") ?? "…"}
            </p>
          )
        ) : (
          <BetweenRounds state={state} busy={busy} run={run} path={path} />
        )}
        {isSpectator && room.status === "playing" && <QueueButton state={state} busy={busy} run={run} path={path} />}
        <ErrorText>{error}</ErrorText>
      </Card>

      {isSpectator && room.status === "playing" && <BetPanel state={state} busy={busy} run={run} path={path} />}
      {state.bets.length > 0 && <BetList bets={state.bets} nick={nick} me={me} />}
      {throws.length > 0 && <ThrowHistory throws={throws} nick={nick} rolling={rolling} />}
      <PeopleList state={state} token={token} refresh={refresh} receivedAt={receivedAt} />
      {room.hostPlayerId === me.id && room.status !== "playing" && (
        <StakePicker state={state} busy={busy} run={run} path={path} />
      )}
      <Rules />
    </>
  );
}

/** True for ROLL_MS after a new throw arrives; plays the rattle. Initial load does not animate. */
function useRolling(last: ThrowItem | null): boolean {
  const [animOn] = useBoolPref(PREF_ANIMATION, true);
  const [soundOn] = useBoolPref(PREF_SOUND, true);
  const seen = useRef<string | null | undefined>(undefined);
  const [rollingKey, setRollingKey] = useState<string | null>(null);
  const key = last ? `${last.seq}:${last.d1}${last.d2}:${last.playerId}` : null;

  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = key; // first render: show the current dice without animating
      return;
    }
    if (key === seen.current) return;
    seen.current = key;
    if (!key) return;
    if (soundOn) playRattle();
    if (!animOn) return;
    const start = window.setTimeout(() => setRollingKey(key), 0);
    const stop = window.setTimeout(() => setRollingKey(null), ROLL_MS);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [key, animOn, soundOn]);

  return rollingKey !== null && rollingKey === key;
}

function SeatCard({ player, state, testId }: { player: PublicPlayer | null; state: RoomState; testId: string }) {
  const { room, me } = state;
  if (!player) {
    return (
      <div data-testid={testId} className="flex min-h-24 flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 p-3 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Loc liber
      </div>
    );
  }
  const hasDice = room.status === "playing" && room.throwerPlayerId === player.id;
  const won = room.status === "finished" && room.winnerPlayerId === player.id;
  return (
    <div
      data-testid={testId}
      className={`flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl border-2 p-3 text-center transition-colors ${
        hasDice
          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950"
          : won
            ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
            : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <span className="max-w-full truncate font-bold">
        {won && "🏆 "}
        {player.nickname}
        {player.id === me.id && <span className="font-normal text-zinc-500"> (tu)</span>}
      </span>
      <OfflineBadge player={player} />
      <Balance value={player.balance} />
      <span className="h-5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">{hasDice ? "🎲 are zarurile" : ""}</span>
    </div>
  );
}

function Balance({ value }: { value: number }) {
  const cls = value > 0 ? "text-emerald-600 dark:text-emerald-400" : value < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-500";
  return <span className={`font-mono text-sm font-semibold ${cls}`}>{value > 0 ? `+${value}` : value}</span>;
}

function DiceArea({
  last,
  rolling,
  nick,
  state,
}: {
  last: ThrowItem | null;
  rolling: boolean;
  nick: Map<string, string>;
  state: RoomState;
}) {
  const { room } = state;
  const tone = !last || rolling ? "plain" : last.outcome === "win" ? "win" : last.outcome === "lose" ? "lose" : "plain";
  const who = last?.playerId ? (nick.get(last.playerId) ?? "Cineva") : "Cineva";
  let caption = "";
  if (room.status === "waiting" && room.round === 0) caption = "Încă nu s-a aruncat.";
  else if (rolling) caption = `${who} aruncă…`;
  else if (last) {
    const label = throwLabel(last.d1, last.d2);
    caption =
      last.outcome === "win"
        ? `${who}: ${label}. Câștigă!`
        : last.outcome === "lose"
          ? `${who}: ${label}. Pierde!`
          : `${who}: ${label}. Neutru, zarurile trec.`;
  } else if (room.status === "playing") caption = "Mână nouă. Se așteaptă prima aruncare.";

  // While rolling, flicker random faces; afterwards show the real ones.
  const [face, setFace] = useState<[number, number]>([6, 5]);
  useEffect(() => {
    if (!rolling) return;
    const id = window.setInterval(() => setFace([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 90);
    return () => window.clearInterval(id);
  }, [rolling]);
  const shown: [number | null, number | null] = rolling ? face : last ? [last.d1, last.d2] : [null, null];

  const winner = room.status === "finished" && room.winnerPlayerId ? nick.get(room.winnerPlayerId) : null;

  return (
    <div
      data-testid="dice-area"
      data-throw-count={state.throws.length}
      className="flex flex-col items-center gap-3 rounded-xl bg-emerald-800 px-3 py-6 text-white shadow-inner dark:bg-emerald-950">
      <div className="flex gap-4">
        <Die value={shown[0]} rolling={rolling} tone={tone} />
        <Die value={shown[1]} rolling={rolling} tone={tone} />
      </div>
      <p className="min-h-5 text-center text-sm font-semibold" aria-live="polite">
        {caption}
      </p>
      {winner && !rolling && (
        <p data-testid="round-winner" className="rounded-full bg-amber-400 px-4 py-1 text-center text-sm font-black text-amber-950">
          🏆 {room.winnerPlayerId === state.me.id ? "Ai câștigat mâna!" : `${winner} câștigă mâna`} (+{room.stake})
        </p>
      )}
    </div>
  );
}

type Run = (key: string, path: string, body?: unknown) => Promise<void>;

function BetweenRounds({ state, busy, run, path }: { state: RoomState; busy: string | null; run: Run; path: (a: string) => string }) {
  const { room, me, players } = state;
  const full = Boolean(room.seatA && room.seatB);
  const spectators = players.filter((p) => p.seat === null).length;

  if (me.seat !== null) {
    return (
      <div className="flex flex-col gap-2">
        {full ? (
          <Button className="min-h-14 text-lg" data-testid="start-round" disabled={busy !== null} onClick={() => void run("start", path("start"))}>
            {busy === "start" ? "Se pornește…" : room.round === 0 ? "Începe jocul" : "Mână nouă"}
          </Button>
        ) : (
          <p className="rounded-lg bg-zinc-100 py-3 text-center text-sm font-semibold dark:bg-zinc-900">
            Se așteaptă al doilea jucător. Trimite-i codul camerei.
          </p>
        )}
        <Button
          variant="secondary"
          data-testid="stand-up"
          disabled={busy !== null || spectators >= MAX_SPECTATORS}
          onClick={() => void run("stand", path("seat"), { action: "stand" })}
        >
          Ridică-te de la masă (devii chibiț)
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {full ? (
        <p className="rounded-lg bg-zinc-100 py-3 text-center text-sm font-semibold dark:bg-zinc-900">
          Ești chibiț. Jucătorii pornesc mâna următoare.
        </p>
      ) : (
        <Button className="min-h-14 text-lg" data-testid="sit-down" disabled={busy !== null} onClick={() => void run("sit", path("seat"), { action: "sit" })}>
          {busy === "sit" ? "Te așezi…" : "Ia locul la masă"}
        </Button>
      )}
      <QueueButton state={state} busy={busy} run={run} path={path} />
    </div>
  );
}

/** Spectator toggle: "Intră la runda următoare" (queue for a seat at the next round). */
export function QueueButton({ state, busy, run, path }: { state: RoomState; busy: string | null; run: Run; path: (a: string) => string }) {
  const { me } = state;
  if (me.seat !== null) return null;
  return (
    <Button variant="secondary" data-testid="queue-toggle" disabled={busy !== null} onClick={() => void run("queue", path("queue"), {})}>
      {busy === "queue"
        ? "…"
        : me.queuePosition !== null
          ? `În coadă (#${me.queuePosition}) · apasă ca să ieși`
          : "Intră la runda următoare"}
    </Button>
  );
}

function BetPanel({ state, busy, run, path }: { state: RoomState; busy: string | null; run: Run; path: (a: string) => string }) {
  const { room, me, players, bets } = state;
  const seated = players.filter((p) => p.seat !== null);
  const mine = bets.filter((b) => b.playerId === me.id);
  const myBraila = mine.find((b) => b.kind === "braila");
  const openSan = mine.find((b) => b.kind === "san" && b.status === "open");
  const thrower = players.find((p) => p.id === room.throwerPlayerId);

  return (
    <Card testId="bet-panel">
      <h2 className="mb-1 font-bold">Pariuri de chibiț</h2>
      <p className="mb-3 text-xs text-zinc-500">Fiecare pariu e de {room.stake} jetoane (miza mesei).</p>
      <div className="flex flex-col gap-3">
        <div>
          <p className="mb-1 text-sm font-semibold">Brăila: ții cu un jucător până la final de mână</p>
          {myBraila ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Ai Brăila pe <b>{seated.find((p) => p.id === myBraila.targetPlayerId)?.nickname ?? "…"}</b>.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {seated.map((p) => (
                <Button
                  key={p.id}
                  variant="secondary"
                  data-testid="bet-braila"
                  disabled={busy !== null}
                  onClick={() => void run(`braila:${p.id}`, path("bet"), { kind: "braila", targetPlayerId: p.id })}
                  className="truncate"
                >
                  {busy === `braila:${p.id}` ? "…" : `Brăila pe ${p.nickname}`}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Șan: pe următoarea aruncare a celui cu zarurile</p>
          {openSan ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Ai Șan pe mâna lui <b>{players.find((p) => p.id === openSan.targetPlayerId)?.nickname ?? "…"}</b>. Se decide la
              aruncarea următoare.
            </p>
          ) : (
            <Button
              className="w-full"
              data-testid="bet-san"
              disabled={busy !== null || !thrower}
              onClick={() => void run("san", path("bet"), { kind: "san" })}
            >
              {busy === "san" ? "…" : `Șan pe mâna lui ${thrower?.nickname ?? "…"}`}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function BetList({ bets, nick, me }: { bets: BetItem[]; nick: Map<string, string>; me: PublicPlayer }) {
  const badge = {
    open: ["deschis", "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"],
    won: ["câștigat", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"],
    lost: ["pierdut", "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"],
    void: ["anulat", "bg-zinc-100 text-zinc-500 dark:bg-zinc-900"],
  } as const;
  return (
    <Card testId="bet-list">
      <h2 className="mb-2 font-bold">Pariurile mâinii</h2>
      <ul className="flex flex-col gap-1 text-sm">
        {[...bets].reverse().map((b) => {
          const [label, cls] = badge[b.status];
          const target = nick.get(b.targetPlayerId ?? "") ?? "?";
          return (
            <li key={b.id} data-status={b.status} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <b>{nick.get(b.playerId) ?? "?"}</b>
                {b.playerId === me.id && <span className="text-zinc-500"> (tu)</span>}:{" "}
                {b.kind === "braila" ? `Brăila pe ${target}` : `Șan pe mâna lui ${target} (aruncarea ${b.throwSeq})`} · {b.amount}
              </span>
              <span className={`shrink-0 rounded px-1.5 text-[11px] font-semibold ${cls}`}>{label}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ThrowHistory({ throws, nick, rolling }: { throws: ThrowItem[]; nick: Map<string, string>; rolling: boolean }) {
  const visible = rolling ? throws.slice(0, -1) : throws;
  if (visible.length === 0) return null;
  return (
    <Card testId="throw-history">
      <h2 className="mb-2 font-bold">Aruncările mâinii</h2>
      <ol className="flex flex-col gap-1.5">
        {[...visible].reverse().map((t) => (
          <li key={t.seq} className="flex items-center gap-2 text-sm">
            <span className="w-6 text-right font-mono text-xs text-zinc-500">{t.seq}.</span>
            <Die value={t.d1} size="sm" />
            <Die value={t.d2} size="sm" />
            <span className="min-w-0 flex-1 truncate">{nick.get(t.playerId ?? "") ?? "Plecat"}</span>
            <span
              className={`text-xs font-semibold ${
                t.outcome === "win" ? "text-emerald-600 dark:text-emerald-400" : t.outcome === "lose" ? "text-rose-600 dark:text-rose-400" : "text-zinc-500"
              }`}
            >
              {t.outcome === "win" ? "câștigă" : t.outcome === "lose" ? "pierde" : "trece"}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Shown next to a member not seen for 45 s (phone in the background, closed tab, no network). */
function OfflineBadge({ player }: { player: PublicPlayer }) {
  if (player.connected !== false) return null;
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      deconectat
    </span>
  );
}

function KickBadge({ player, receivedAt }: { player: PublicPlayer; receivedAt: number }) {
  const seconds = useKickSeconds(player.kickRemainingMs, receivedAt);
  if (seconds === null) return null;
  return (
    <span className="rounded bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
      iese în {seconds} s
    </span>
  );
}

function PeopleList({ state, token, refresh, receivedAt }: Props) {
  const { players, me, room } = state;
  const canKick = room.hostPlayerId === me.id;
  const { busy, error, run } = useAction(token, refresh);
  const spectators = players.filter((p) => p.seat === null);

  // Host reorders between rounds: arrows move a member within its group (seated / queue / other spectators).
  const groupOf = (p: PublicPlayer) => (p.seat ? "seat" : p.queuePosition !== null ? "queue" : "other");
  const canReorder = canKick && room.status !== "playing";
  async function move(index: number, dir: -1 | 1) {
    const order = players.map((p) => p.id);
    [order[index], order[index + dir]] = [order[index + dir], order[index]];
    await run(`move:${players[index].id}`, `/api/rooms/${room.code}/reorder`, { order });
  }

  async function kick(p: PublicPlayer) {
    const midRound =
      room.status === "playing" && p.seat !== null ? " Are 10 secunde să refuze; dacă nu, mâna în curs se anulează." : "";
    if (!window.confirm(`Scoți jucătorul ${p.nickname} din cameră?${midRound}`)) return;
    await run(p.id, `/api/rooms/${room.code}/kick`, { playerId: p.id });
  }

  return (
    <Card testId="people-list">
      <h2 className="mb-1 font-bold">
        În cameră <span className="text-sm font-normal text-zinc-500">· {spectators.length}/{MAX_SPECTATORS} chibiți</span>
      </h2>
      {canReorder && <p className="mb-1 text-xs text-zinc-500">Cu ↑↓ alegi cine aruncă primul (locul A) și ordinea cozii.</p>}
      <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {players.map((p, i) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">
                {p.nickname}
                {p.id === me.id && <span className="text-zinc-500"> (tu)</span>}
              </span>
              <span
                className={`rounded px-1.5 text-[10px] font-semibold uppercase ${
                  p.seat ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "bg-zinc-200 dark:bg-zinc-800"
                }`}
              >
                {p.seat ? "la masă" : p.queuePosition !== null ? `coadă #${p.queuePosition}` : "chibiț"}
              </span>
              {p.isHost && <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-semibold uppercase dark:bg-zinc-800">host</span>}
              <OfflineBadge player={p} />
              <KickBadge player={p} receivedAt={receivedAt} />
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {canReorder && (
                <span className="flex gap-1">
                  {([-1, 1] as const).map((dir) => {
                    const neighbour = players[i + dir];
                    const ok = neighbour !== undefined && groupOf(neighbour) === groupOf(p);
                    return (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => void move(i, dir)}
                        disabled={busy !== null || !ok}
                        className="min-h-8 min-w-8 rounded-md border border-zinc-300 text-sm font-bold disabled:opacity-30 dark:border-zinc-700"
                        aria-label={`${dir === -1 ? "Mută în sus" : "Mută în jos"} pe ${p.nickname}`}
                      >
                        {dir === -1 ? "↑" : "↓"}
                      </button>
                    );
                  })}
                </span>
              )}
              <Balance value={p.balance} />
              {canKick && p.id !== me.id && (
                <button
                  type="button"
                  onClick={() => void kick(p)}
                  disabled={busy !== null}
                  className="min-h-8 rounded-md border border-rose-300 px-2 text-xs font-semibold text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
                  aria-label={`Scoate pe ${p.nickname}`}
                >
                  {busy === p.id ? "…" : "Scoate"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

function StakePicker({ state, busy, run, path }: { state: RoomState; busy: string | null; run: Run; path: (a: string) => string }) {
  const options: number[] = STAKE_OPTIONS.includes(state.room.stake as (typeof STAKE_OPTIONS)[number])
    ? [...STAKE_OPTIONS]
    : [...STAKE_OPTIONS, state.room.stake].sort((a, b) => a - b);
  return (
    <Card>
      <label className="flex items-center justify-between gap-3 text-sm font-medium">
        Miza pe mână (doar host, între mâini)
        <select
          value={state.room.stake}
          disabled={busy !== null}
          onChange={(e) => void run("stake", path("settings"), { stake: Number(e.target.value) })}
          className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </Card>
  );
}
