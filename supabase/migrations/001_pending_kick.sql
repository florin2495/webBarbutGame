-- Pending host kick during a running round: the player has 10 s to press "Ignoră" (null = no pending kick).
alter table public.barbut_players add column if not exists kick_requested_at timestamptz;
