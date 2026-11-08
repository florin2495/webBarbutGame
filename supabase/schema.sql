-- Barbut multiplayer - Supabase schema
-- Lives in the same Supabase project as Bingo; every object is prefixed with barbut_ so nothing collides.
-- Run this whole file once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
-- Idempotent: re-running it drops nothing.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- barbut_rooms: one row per room. Two seats (seat_a / seat_b) play, everyone else
-- in the room is a spectator (max 16). A "round" ("mână") ends at the first
-- decisive throw. throw_count is the optimistic-concurrency token for throws.
-- ---------------------------------------------------------------------------
create table if not exists public.barbut_rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  name              text not null check (char_length(name) between 1 and 40),
  password_hash     text,                                   -- scrypt hash, null = no password
  stake             integer not null default 10 check (stake between 1 and 1000),
  status            text not null default 'waiting' check (status in ('waiting', 'playing', 'finished')),
  round             integer not null default 0 check (round >= 0),
  seat_a            uuid,
  seat_b            uuid,
  thrower_player_id uuid,                                   -- who holds the dice right now
  winner_player_id  uuid,                                   -- winner of the last finished round
  throw_count       integer not null default 0,             -- throws in the current round
  host_player_id    uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index if not exists barbut_rooms_status_activity_idx on public.barbut_rooms (status, last_activity_at);

-- ---------------------------------------------------------------------------
-- barbut_players: everyone in a room. Seated = referenced by barbut_rooms.seat_a/b.
-- Identity = random browser token, only its SHA-256 hash is stored.
-- balance = virtual chips won/lost in this room (can go negative, no real money).
-- ---------------------------------------------------------------------------
create table if not exists public.barbut_players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.barbut_rooms (id) on delete cascade,
  nickname   text not null check (char_length(nickname) between 1 and 20),
  token_hash text not null unique,
  is_host    boolean not null default false,
  balance    integer not null default 0,
  joined_at  timestamptz not null default now(),
  kick_requested_at timestamptz,                             -- pending host kick (10 s to press "Ignoră"), null = none
  last_seen_at timestamptz not null default now(),           -- presence: disconnected after 45 s, see migrations/002
  device_hash  text,                                         -- sha256 of the browser's device id, see migrations/002
  queued_at    timestamptz                                   -- spectator waiting for a seat at the next round, see migrations/003
);
-- Idempotent for databases created before these columns (supabase/migrations/001_pending_kick.sql, 002_reconnect.sql).
alter table public.barbut_players add column if not exists kick_requested_at timestamptz;
alter table public.barbut_players add column if not exists last_seen_at timestamptz not null default now();
alter table public.barbut_players add column if not exists device_hash text;
alter table public.barbut_players add column if not exists queued_at timestamptz;
create unique index if not exists barbut_players_room_nickname_uq on public.barbut_players (room_id, lower(nickname));
create index if not exists barbut_players_room_idx on public.barbut_players (room_id);
create index if not exists barbut_players_room_seen_idx on public.barbut_players (room_id, last_seen_at);

do $$ begin
  alter table public.barbut_rooms add constraint barbut_rooms_seat_a_fk
    foreign key (seat_a) references public.barbut_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.barbut_rooms add constraint barbut_rooms_seat_b_fk
    foreign key (seat_b) references public.barbut_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.barbut_rooms add constraint barbut_rooms_thrower_fk
    foreign key (thrower_player_id) references public.barbut_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.barbut_rooms add constraint barbut_rooms_winner_fk
    foreign key (winner_player_id) references public.barbut_players (id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.barbut_rooms add constraint barbut_rooms_host_fk
    foreign key (host_player_id) references public.barbut_players (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- barbut_throws: every throw of every round. unique (room_id, round, seq) makes a
-- double-tap / two tabs unable to record two throws for the same slot.
-- ---------------------------------------------------------------------------
create table if not exists public.barbut_throws (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.barbut_rooms (id) on delete cascade,
  round      integer not null,
  seq        integer not null check (seq >= 1),
  player_id  uuid references public.barbut_players (id) on delete set null,
  d1         smallint not null check (d1 between 1 and 6),
  d2         smallint not null check (d2 between 1 and 6),
  outcome    text not null check (outcome in ('win', 'lose', 'neutral')),
  created_at timestamptz not null default now(),
  unique (room_id, round, seq)
);

-- ---------------------------------------------------------------------------
-- barbut_bets: spectator side bets ("chibiți").
--   braila: on one of the two players, settled when the round ends.
--   san:    on the current thrower's next throw ("pe mâna lui"), settled by
--           that one throw: win -> won, lose -> lost, neutral -> void.
-- ---------------------------------------------------------------------------
create table if not exists public.barbut_bets (
  id               bigint generated always as identity primary key,
  room_id          uuid not null references public.barbut_rooms (id) on delete cascade,
  round            integer not null,
  player_id        uuid not null references public.barbut_players (id) on delete cascade,
  kind             text not null check (kind in ('braila', 'san')),
  target_player_id uuid references public.barbut_players (id) on delete set null,
  throw_seq        integer,                                -- san only: the throw it is settled by
  amount           integer not null check (amount between 1 and 1000),
  status           text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  created_at       timestamptz not null default now()
);
create index if not exists barbut_bets_room_round_idx on public.barbut_bets (room_id, round);
-- At most one Brăila per spectator per round, and one open Șan at a time.
create unique index if not exists barbut_bets_one_braila_uq on public.barbut_bets (room_id, round, player_id) where kind = 'braila';
create unique index if not exists barbut_bets_one_open_san_uq on public.barbut_bets (player_id) where kind = 'san' and status = 'open';

-- ---------------------------------------------------------------------------
-- Security: RLS on, NO policies -> anon / authenticated can read or write
-- nothing. Only the service role (Next.js Route Handlers) touches these tables.
-- ---------------------------------------------------------------------------
alter table public.barbut_rooms   enable row level security;
alter table public.barbut_players enable row level security;
alter table public.barbut_throws  enable row level security;
alter table public.barbut_bets    enable row level security;

revoke all on public.barbut_rooms, public.barbut_players, public.barbut_throws, public.barbut_bets from anon, authenticated;
