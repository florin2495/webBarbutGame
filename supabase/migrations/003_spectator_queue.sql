-- Spectator queue ("Intră la runda următoare"): when set, the spectator takes a free seat at the next round, in queue order.
alter table public.barbut_players add column if not exists queued_at timestamptz;
