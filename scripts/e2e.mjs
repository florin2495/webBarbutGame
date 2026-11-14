// End-to-end test of the Barbut API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /barbut]
// Default: production. Every room is named "e2e-test-..." and deleted at the end (leave as everyone, then a
// DB delete of leftovers by code with the service key as a safety net: env NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (GitHub Actions secrets), else .env.local). Never sends feedback (hub_feedback).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/barbut").replace(/\/$/, "");
const MAX_SPECTATORS = 16; // src/lib/game.ts
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;

// Copy of the rules in src/lib/game.ts (the server is the source of truth; this checks it).
function outcomeOf(d1, d2) {
  const k = `${Math.min(d1, d2)}-${Math.max(d1, d2)}`;
  if (["6-6", "5-5", "3-3", "5-6"].includes(k)) return "win";
  if (["1-1", "2-2", "4-4", "1-2"].includes(k)) return "lose";
  return "neutral";
}

/** Everything but `me` must be identical for every member. */
const shared = (s) => JSON.stringify({ room: s.room, players: s.players.map((p) => ({ ...p, connected: undefined })), throws: s.throws, bets: s.bets });

/** Throws until the round ends; checks turn order and outcomes. Returns the final state. */
async function playRound(code, byId, viewer) {
  let s = await state(code, viewer);
  let guard = 0;
  let ok = true;
  while (s.room.status === "playing" && guard++ < 200) {
    const thrower = byId[s.room.throwerPlayerId];
    const other = s.room.seatA === thrower.playerId ? s.room.seatB : s.room.seatA;
    const res = await call(`/api/rooms/${code}/throw`, { token: thrower.token, body: {} });
    if (res.status !== 200) {
      check(false, `throw failed: ${res.status} ${res.data.error}`);
      return s;
    }
    const { d1, d2, outcome } = res.data;
    if (outcome !== outcomeOf(d1, d2) || d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) ok = false;
    s = await state(code, viewer);
    if (outcome === "neutral" && (s.room.throwerPlayerId !== other || s.room.status !== "playing")) ok = false;
    if (outcome === "win" && (s.room.winnerPlayerId !== thrower.playerId || s.room.status !== "finished")) ok = false;
    if (outcome === "lose" && (s.room.winnerPlayerId !== other || s.room.status !== "finished")) ok = false;
  }
  check(ok, `round ${s.room.round}: ${s.throws.length} throws, outcomes and dice passing follow the rules`);
  check(s.room.status === "finished" && s.room.winnerPlayerId, "round finished with a winner");
  return s;
}

/** Expected balance change of every member for a finished round, from its throws and bets. */
function expectedDeltas(s) {
  const d = {};
  const add = (id, x) => (d[id] = (d[id] ?? 0) + x);
  const w = s.room.winnerPlayerId;
  const l = w === s.room.seatA ? s.room.seatB : s.room.seatA;
  add(w, s.room.stake);
  add(l, -s.room.stake);
  for (const b of s.bets) {
    let st;
    if (b.kind === "braila") st = b.targetPlayerId === w ? "won" : "lost";
    else {
      const t = s.throws.find((x) => x.seq === b.throwSeq);
      st = !t || t.outcome === "neutral" ? "void" : t.outcome === "win" ? "won" : "lost";
    }
    if (b.status !== st) d.__badBet = true;
    add(b.playerId, st === "won" ? b.amount : st === "lost" ? -b.amount : 0);
  }
  return d;
}

async function httpChecks() {
  console.log("HTTP");
  const page = await fetch(BASE + "/");
  const html = await page.text();
  check(page.status === 200 && html.includes("Barbut"), `page 200 (${page.status})`);
  const assets = [...new Set(html.match(/\/barbut\/_next\/static\/[^"'\s)]+/g) ?? [])];
  const origin = new URL(BASE).origin;
  const codes = await Promise.all(assets.slice(0, 15).map(async (a) => (await fetch(origin + a)).status));
  check(assets.length > 0 && codes.every((c) => c === 200), `${assets.length} /_next assets referenced, first ${codes.length} all 200`);
  // The version is shown in the settings panel of the room page: look in the JS chunks of both pages.
  const roomHtml = await (await fetch(BASE + "/room/XXXXXX")).text();
  const js = [...new Set((html + roomHtml).match(/\/barbut\/_next\/static\/[^"'\s)\\]+\.js/g) ?? [])];
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of js) if (!hasVersion && (await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version} (${js.length} chunks)`);
  const manifest = await fetch(BASE + "/manifest.webmanifest");
  const m = await manifest.json().catch(() => ({}));
  check(manifest.status === 200 && m.start_url === "/barbut/", `manifest 200 (${manifest.status})`);
  check(html.includes("/barbut/manifest.webmanifest"), "page links the manifest under /barbut");
  for (const icon of [...(m.icons ?? []).map((i) => i.src), "/barbut/pwa-icon/apple", "/barbut/favicon.ico"]) {
    const r = await fetch(origin + icon);
    check(r.status === 200 && /image/.test(r.headers.get("content-type") ?? ""), `${icon} 200 image (${r.status})`);
  }
  const room = await fetch(BASE + "/room/XXXXXX");
  check(room.status === 200, `GET /barbut/room/XXXXXX 200 (${room.status})`);
  const vercel = "https://web-barbut-game.vercel.app/barbut";
  if (!BASE.startsWith(vercel)) {
    const v = await fetch(vercel);
    const vh = await v.text();
    const vAssets = [...new Set(vh.match(/\/barbut\/_next\/static\/[^"'\s)]+\.js/g) ?? [])].sort();
    const pAssets = assets.filter((a) => a.endsWith(".js")).sort();
    check(v.status === 200 && JSON.stringify(vAssets) === JSON.stringify(pAssets), `${vercel} 200 with the same JS chunks`);
  }
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();

  console.log("Create, list, join");
  const dev = { Ana: randomUUID(), Bob: randomUUID(), Cris: randomUUID(), Dan: randomUUID() };
  const name = `e2e-test-${Date.now().toString(36)}`;
  const r = await call("/api/rooms", { body: { name, nickname: "Ana", password: "pw", stake: 10, deviceId: dev.Ana } });
  check(r.status === 200 && /^[A-Z2-9]{6}$/.test(r.data.code ?? ""), `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  check((await call("/api/rooms", { body: { name: "e2e-test-bad", nickname: "Ana", stake: 5000 } })).status === 400, "stake 5000 = 400");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  check((await call(`/api/rooms/ZZZZZZ/join`, { body: { nickname: "Bob" } })).status === 404, "unknown room = 404");
  const join = async (nickname, extra = {}) => {
    const res = await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId: dev[nickname], ...extra } });
    return { ...res.data, status: res.status, name: nickname };
  };
  const B = await join("Bob");
  check(B.status === 200, "Bob joins");
  const C = await join("Cris");
  const D = await join("Dan");
  check(C.status === 200 && D.status === 200, "Cris and Dan join");
  let s = await state(code, A);
  check(s.room.seatA === A.playerId && s.room.seatB === B.playerId, "Ana seat A (host), Bob seat B");
  check(s.players.filter((p) => p.seat === null).length === 2, "Cris and Dan are spectators");
  check(s.me.isHost && !s.players.find((p) => p.id === B.playerId).isHost, "only Ana is host");
  const list = await call("/api/rooms");
  const item = list.data.rooms?.find((x) => x.code === code);
  check(item && item.hasPassword && item.seated === 2 && item.spectators === 2 && item.name === name && item.status === "waiting", "room in public list (password, 2 seated, 2 spectators, waiting)");
  check(!JSON.stringify(list.data).includes("password_hash"), "list leaks no password hash");

  console.log("Spectator limit");
  const extra = [];
  for (let i = 1; i <= MAX_SPECTATORS - 2; i++) extra.push(await join(`Sp${i}`, { deviceId: randomUUID() }));
  check(extra.every((x) => x.status === 200), `${extra.length} more spectators join (${MAX_SPECTATORS} total)`);
  check((await join("SpX", { deviceId: randomUUID() })).status === 409, `spectator #${MAX_SPECTATORS + 1} = 409`);
  const full = (await call("/api/rooms")).data.rooms?.find((x) => x.code === code);
  check(full && full.spectators === MAX_SPECTATORS, `full room still in the public list, with ${MAX_SPECTATORS} spectators`);
  for (const x of extra) {
    const res = await call(`/api/rooms/${code}/leave`, { token: x.token, body: {} });
    if (res.status !== 200) check(false, `${x.name} leaves (${res.status})`);
  }
  check(true, `the ${extra.length} extra spectators leave`);

  console.log("Rejoin with the saved token / same device");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: randomUUID() } })).status === 409, "Bob's nickname from another device while connected = 409");
  const B2 = await join("Bob");
  check(B2.status === 200 && B2.playerId === B.playerId && B2.token !== B.token, "Bob rejoins from the same device: same player, new token");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "Bob's old token = 401");
  B.token = B2.token;
  s = await state(code, B);
  check(s.me.id === B.playerId && s.me.seat === "B", "Bob keeps seat B");
  check((await call(`/api/rooms/${code}/state`, { token: "forged-token" })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "no token = 401");

  console.log("Settings and start");
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { stake: 25 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { stake: 0 } })).status === 400, "stake 0 = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { stake: 25 } })).status === 200, "host sets stake 25");
  check((await call(`/api/rooms/${code}/throw`, { token: A.token, body: {} })).status === 409, "throw before start = 409");
  check((await call(`/api/rooms/${code}/start`, { token: C.token, body: {} })).status === 403, "spectator start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 200, "Bob starts round 1");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "second start = 409");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { stake: 10 } })).status === 409, "stake change mid-round = 409");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { action: "stand" } })).status === 409, "stand up mid-round = 409");
  s = await state(code, C);
  check(s.room.status === "playing" && s.room.round === 1 && s.room.throwerPlayerId === A.playerId && s.room.stake === 25, "round 1: seat A throws first, stake 25");

  console.log("Invalid moves and bets");
  check((await call(`/api/rooms/${code}/throw`, { token: B.token, body: {} })).status === 409, "throw out of turn = 409");
  check((await call(`/api/rooms/${code}/throw`, { token: C.token, body: {} })).status === 409, "spectator throw = 409");
  check((await call(`/api/rooms/${code}/throw`, { token: "nope", body: {} })).status === 401, "throw with bad token = 401");
  check((await call(`/api/rooms/${code}/bet`, { token: A.token, body: { kind: "san" } })).status === 403, "seated player bet = 403");
  check((await call(`/api/rooms/${code}/bet`, { token: C.token, body: { kind: "braila", targetPlayerId: C.playerId } })).status === 400, "Brăila on a spectator = 400");
  check((await call(`/api/rooms/${code}/bet`, { token: C.token, body: { kind: "poker" } })).status === 400, "unknown bet = 400");
  check((await call(`/api/rooms/${code}/bet`, { token: C.token, body: { kind: "braila", targetPlayerId: A.playerId } })).status === 200, "Cris: Brăila on Ana");
  check((await call(`/api/rooms/${code}/bet`, { token: C.token, body: { kind: "braila", targetPlayerId: B.playerId } })).status === 409, "second Brăila = 409");
  check((await call(`/api/rooms/${code}/bet`, { token: D.token, body: { kind: "san" } })).status === 200, "Dan: Șan on the next throw");
  check((await call(`/api/rooms/${code}/bet`, { token: D.token, body: { kind: "san" } })).status === 409, "second open Șan = 409");
  check((await call(`/api/rooms/${code}/bet`, { token: D.token, body: { kind: "braila", targetPlayerId: B.playerId } })).status === 200, "Dan: Brăila on Bob");

  console.log("State consistency");
  const views = await Promise.all([A, B, C, D].map((p) => state(code, p)));
  check(views.every((v) => shared(v) === shared(views[0])), "all 4 members see the same room, players, throws and bets");
  check(views.every((v, i) => v.me.id === [A, B, C, D][i].playerId), "each member sees itself as `me`");
  const keys = JSON.stringify(views[0]).match(/"[A-Za-z_]+":/g) ?? [];
  check(!keys.some((k) => /token|hash|device|password/i.test(k) && k !== '"hasPassword":'), "state leaks no token/hash/device/password");
  check(views[0].bets.length === 3 && views[0].bets.every((b) => b.amount === 25 && b.status === "open"), "3 open bets of 25");

  console.log("Concurrent double throw");
  const byId = { [A.playerId]: A, [B.playerId]: B };
  const dbl = await Promise.all([1, 2].map(() => call(`/api/rooms/${code}/throw`, { token: A.token, body: {} })));
  check(dbl.filter((x) => x.status === 200).length === 1 && dbl.filter((x) => x.status === 409).length === 1, "two simultaneous throws: one 200, one 409");
  s = await state(code, C);
  check(s.throws.length === 1, "only one throw recorded");

  console.log("Play round 1 to the end");
  s = await playRound(code, byId, C);
  const before = { [A.playerId]: 0, [B.playerId]: 0, [C.playerId]: 0, [D.playerId]: 0 };
  const exp = expectedDeltas(s);
  check(!exp.__badBet, "every bet settled correctly (Brăila on the winner, Șan by its throw)");
  const bal = Object.fromEntries(s.players.map((p) => [p.id, p.balance]));
  check(Object.keys(before).every((id) => bal[id] === before[id] + (exp[id] ?? 0)), `balances match the rules ${JSON.stringify(Object.values(bal))}`);
  check((await call(`/api/rooms/${code}/throw`, { token: byId[s.room.throwerPlayerId].token, body: {} })).status === 409, "throw after the round ended = 409");
  check((await call(`/api/rooms/${code}/bet`, { token: C.token, body: { kind: "san" } })).status === 409, "bet between rounds = 409");

  console.log("New round, rejoin mid-round");
  const winner1 = s.room.winnerPlayerId;
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "round 2 starts");
  s = await state(code, D);
  check(s.room.round === 2 && s.room.throwerPlayerId === winner1 && s.throws.length === 0 && s.bets.length === 0, "round 2: last winner throws first, clean throws/bets");
  const B3 = await join("Bob");
  check(B3.status === 200 && B3.playerId === B.playerId, "Bob rejoins mid-round from the same device");
  B.token = B3.token;
  s = await state(code, B);
  check(s.me.seat === "B" && s.room.status === "playing" && s.me.balance === bal[B.playerId], "Bob keeps seat, round and balance");
  const bal1 = bal;
  s = await playRound(code, byId, D);
  const exp2 = expectedDeltas(s);
  const bal2 = Object.fromEntries(s.players.map((p) => [p.id, p.balance]));
  check(Object.keys(bal1).every((id) => bal2[id] === bal1[id] + (exp2[id] ?? 0)), "round 2 balances match");
  check(bal2[A.playerId] + bal2[B.playerId] === 0, "seated players' chips sum to zero");

  console.log("Seats between rounds");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { action: "sit" } })).status === 409, "sit with no free seat = 409");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { action: "stand" } })).status === 200, "Bob stands up");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start alone = 409");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { action: "sit" } })).status === 200, "Cris sits down");
  s = await state(code, A);
  check(s.room.seatB === C.playerId && s.players.find((p) => p.id === B.playerId).seat === null, "Cris on seat B, Bob spectator");
  check((await call(`/api/rooms/${code}/seat`, { token: C.token, body: { action: "stand" } })).status === 200, "Cris stands up");
  check((await call(`/api/rooms/${code}/seat`, { token: B.token, body: { action: "sit" } })).status === 200, "Bob sits back");

  console.log("Queue and host reorder");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: {} })).status === 409, "seated player queue = 409");
  const q1 = await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} });
  const q2 = await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} });
  check(q1.status === 200 && q1.data.queued === true && q2.data.queued === true, `Cris then Dan queue for the next round (${q1.status} ${q1.data.error ?? ""})`);
  s = await state(code, A);
  const pos = (st, id) => st.players.find((p) => p.id === id)?.queuePosition;
  check(pos(s, C.playerId) === 1 && pos(s, D.playerId) === 2, "queue positions: Cris #1, Dan #2");
  check(s.players.map((p) => p.id).join() === [A, B, C, D].map((p) => p.playerId).join(), "players listed seated first, then the queue");
  check((await call(`/api/rooms/${code}/reorder`, { token: B.token, body: { order: [B, A, D, C].map((p) => p.playerId) } })).status === 403, "non-host reorder = 403");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A.playerId, B.playerId] } })).status === 400, "reorder with missing members = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [B, A, D, C].map((p) => p.playerId) } })).status === 200, "host reorders: Bob, Ana, Dan, Cris");
  s = await state(code, C);
  check(s.room.seatA === B.playerId && s.room.seatB === A.playerId, "Bob on seat A (throws first), Ana on seat B");
  check(pos(s, D.playerId) === 1 && pos(s, C.playerId) === 2, "queue reordered: Dan #1, Cris #2");
  const q3 = await call(`/api/rooms/${code}/queue`, { token: D.token, body: {} });
  const q4 = await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} });
  check(q3.data.queued === false && q4.data.queued === false, "both leave the queue (toggle)");
  s = await state(code, A);
  check(s.players.every((p) => p.queuePosition === null), "nobody queued");

  console.log("Kick");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: D.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicks self = 400");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: "not-a-uuid" } })).status === 404, "kick malformed id = 404");
  const k1 = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } });
  check(k1.status === 200 && !k1.data.pending, "kick spectator between rounds: immediate");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "Dan's token = 401 after kick");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "round 3 starts");
  s = await state(code, A);
  check(s.room.throwerPlayerId === B.playerId, "round 3: seat A (Bob, after the reorder) throws first");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: [A, B, C].map((p) => p.playerId) } })).status === 409, "reorder mid-round = 409");
  const qc = await call(`/api/rooms/${code}/queue`, { token: C.token, body: {} });
  check(qc.status === 200 && qc.data.queued === true, "Cris queues mid-round");
  const k2 = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  check(k2.data.pending === true, "kick seated player mid-round: pending");
  s = await state(code, B);
  check(s.me.kickRemainingMs > 0, "Bob sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: B.token, body: {} })).status === 200, "Bob presses Ignoră");
  check((await state(code, B)).me.kickRemainingMs === null, "kick cleared");
  await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: B.playerId } });
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "kick enforced after 12 s");
  s = await state(code, A);
  check(s.room.status === "waiting" && s.room.seatA === C.playerId && s.room.seatB === A.playerId && s.players.length === 2, "round cancelled, queued Cris takes Bob's free seat");
  check(s.players.every((p) => p.queuePosition === null), "Cris left the queue when seated");

  console.log("Leave and cleanup");
  const l1 = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(l1.status === 200 && !l1.data.roomClosed, "host Ana leaves");
  s = await state(code, C);
  check(s.room.hostPlayerId === C.playerId && s.me.isHost, "host passes to Cris");
  const l2 = await call(`/api/rooms/${code}/leave`, { token: C.token, body: {} });
  check(l2.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB, by code (service key from env or .env.local). */
/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const codes = [...created].join(",");
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/barbut_rooms?code=in.(${codes})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${codes} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
