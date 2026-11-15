"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, clearSession, deviceId, listSessions, parseSession, readSessionRaw, saveSession } from "@/lib/client/api";
import { PREF_NICKNAME, useStringPref, writePref } from "@/lib/client/prefs";
import { NICKNAME_MAX, STAKE_DEFAULT, STAKE_OPTIONS } from "@/lib/game";
import type { RoomListItem, RoomState } from "@/lib/types";
import { Die } from "./Dice";
import { FeedbackButton } from "./FeedbackButton";
import { RoomList } from "./RoomList";
import { Button, Card, ErrorText, Field, Toggle } from "./ui";

interface JoinResult {
  code: string;
  playerId: string;
  token: string;
}

export function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const storedNickname = useStringPref(PREF_NICKNAME);
  const [typedNickname, setNickname] = useState<string | null>(null);
  const nickname = typedNickname ?? storedNickname ?? "";
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [stake, setStake] = useState(STAKE_DEFAULT);
  const [spectate, setSpectate] = useState(false);
  const [code, setCode] = useState("");
  const [picked, setPicked] = useState<RoomListItem | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);

  function pickRoom(room: RoomListItem) {
    setPicked(room);
    setCode(room.code);
    setPassword("");
    setError("");
    setSpectate(room.seated >= 2 || room.status === "playing");
    nicknameRef.current?.focus();
  }

  const showPassword = tab === "create" || !(picked && picked.code === code && !picked.hasPassword);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const joinCode = code.trim().toUpperCase();
    // Already a member on this device: go back to the seat instead of joining again.
    if (tab === "join" && parseSession(readSessionRaw(joinCode))) {
      router.push(`/room/${joinCode}`);
      return;
    }
    setBusy(true);
    setError("");
    writePref(PREF_NICKNAME, nickname.trim());
    try {
      const res =
        tab === "create"
          ? await api<JoinResult>("/api/rooms", { body: { name: roomName, nickname, password, stake, deviceId: deviceId() } })
          : await api<JoinResult>(`/api/rooms/${encodeURIComponent(joinCode)}/join`, {
              body: { nickname, password, spectate, deviceId: deviceId() },
            });
      saveSession(res.code, { playerId: res.playerId, token: res.token });
      router.push(`/room/${res.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- "/" is the hub zone: full navigation, no basePath */}
        <a href="/" className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300">
          ← Back to haiLaTăt.icu hub
        </a>
        <FeedbackButton />
      </div>
      <header className="text-center">
        <div className="mb-3 flex justify-center gap-3" aria-hidden>
          <Die value={6} />
          <Die value={5} />
        </div>
        <h1 className="text-4xl font-black tracking-tight">Barbut</h1>
        <p className="mt-1 text-sm text-zinc-500">Barbut curat, în doi, cu chibiți pe margine. Șan și Brăila incluse.</p>
      </header>

      <RejoinCards onRejoin={(c) => router.push(`/room/${c}`)} />

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-200 p-1 dark:bg-zinc-800" role="tablist">
        {(["create", "join"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              setTab(t);
              setError("");
            }}
            className={`min-h-10 rounded-lg text-sm font-semibold ${tab === t ? "bg-white shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {t === "create" ? "Creează cameră" : "Intră în cameră"}
          </button>
        ))}
      </div>

      {tab === "join" && (
        <Card>
          <h2 className="mb-3 font-bold">Camere disponibile</h2>
          <RoomList
            selected={picked?.code === code ? code : null}
            onSelect={pickRoom}
            onRejoin={(c) => router.push(`/room/${c}`)}
          />
        </Card>
      )}

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {tab === "join" && (
            <Field
              label="Codul camerei"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="ex. K7QM2X"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          )}
          {tab === "create" && (
            <Field label="Numele camerei" value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={40} required />
          )}
          <Field
            ref={nicknameRef}
            label="Nickname-ul tău"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="nickname"
            required
          />
          {showPassword && (
            <Field
              label={tab === "create" ? "Parolă (opțional)" : picked?.code === code ? "Parola camerei" : "Parolă (dacă are camera)"}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={100}
              autoComplete="off"
              required={tab === "join" && picked?.code === code && picked.hasPassword}
            />
          )}

          {tab === "create" && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Miza pe mână (jetoane)
              <select
                value={stake}
                onChange={(e) => setStake(Number(e.target.value))}
                className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
              >
                {STAKE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s} jetoane
                  </option>
                ))}
              </select>
            </label>
          )}
          {tab === "join" && (
            <Toggle
              label="Intru doar ca spectator (chibiț)"
              hint="Poți intra și în timpul mâinii și poți paria Șan sau Brăila."
              checked={spectate}
              onChange={setSpectate}
            />
          )}

          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={busy} data-testid="home-submit">
            {busy ? "Se încarcă…" : tab === "create" ? "Creează camera" : spectate ? "Intră ca spectator" : "Intră"}
          </Button>
        </form>
      </Card>

      <Rules />
    </main>
  );
}

/**
 * Rooms this device still has a valid seat in (also a round in progress or a full room, which the public list
 * may not show). Stored sessions are checked once against /state; 401/404 ones are dropped.
 */
function RejoinCards({ onRejoin }: { onRejoin: (code: string) => void }) {
  const [rooms, setRooms] = useState<{ code: string; name: string; playing: boolean; seated: boolean }[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const checks = await Promise.all(
        listSessions().map(async ({ code, session }) => {
          try {
            const s = await api<RoomState>(`/api/rooms/${code}/state`, { token: session.token });
            return { code, name: s.room.name, playing: s.room.status === "playing", seated: s.me.seat !== null };
          } catch (err) {
            if (err instanceof ApiRequestError && (err.status === 401 || err.status === 404)) clearSession(code);
            return null;
          }
        }),
      );
      if (!cancelled) setRooms(checks.filter((r) => r !== null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {rooms.map((r) => (
        <button
          key={r.code}
          type="button"
          onClick={() => onRejoin(r.code)}
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-3 text-left dark:border-indigo-800 dark:bg-indigo-950"
        >
          <span className="min-w-0">
            <span className="block font-bold">
              Revino în camera <span className="font-mono tracking-widest">{r.code}</span>
            </span>
            <span className="block truncate text-xs text-zinc-600 dark:text-zinc-400">
              {r.name}
              {r.seated ? " · la masă" : " · chibiț"}
              {r.playing ? " · mână în curs" : ""}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-indigo-600 dark:text-indigo-400">Reintră →</span>
        </button>
      ))}
    </div>
  );
}

export function Rules() {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Doi jucători la masă, aruncă pe rând cu două zaruri.</li>
        <li>
          <b className="text-emerald-600 dark:text-emerald-400">Câștigă</b> cine aruncă 6-6, 5-5, 3-3 sau 6-5.
        </li>
        <li>
          <b className="text-rose-600 dark:text-rose-400">Pierde</b> cine aruncă 1-1, 2-2, 4-4 sau 1-2.
        </li>
        <li>Orice altceva e neutru: zarurile trec la adversar.</li>
        <li>Mâna se termină la prima aruncare decisivă. Câștigătorul ia miza și ține zarurile la mâna următoare.</li>
        <li>
          <b>Brăila</b>: un chibiț pariază pe unul dintre jucători. Câștigă sau pierde odată cu el, la finalul mâinii.
        </li>
        <li>
          <b>Șan</b>: un chibiț pariază pe următoarea aruncare a celui cu zarurile („pe mâna lui”). Aruncare câștigătoare:
          câștigă; pierzătoare: pierde; neutră: pariul se anulează.
        </li>
        <li>Se joacă pe jetoane virtuale, fără bani. Soldul fiecăruia se vede în cameră.</li>
      </ol>
    </details>
  );
}
