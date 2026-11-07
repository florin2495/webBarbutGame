import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  stake: number;
  status: "waiting" | "playing" | "finished";
  round: number;
  seat_a: string | null;
  seat_b: string | null;
  thrower_player_id: string | null;
  winner_player_id: string | null;
  throw_count: number;
  host_player_id: string | null;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, stake, status, round, seat_a, seat_b, thrower_player_id, winner_player_id, throw_count, host_player_id, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  balance: number;
  joined_at: string;
  kick_requested_at: string | null;
  /** Presence stamp, touched by requireMember. Needs migration 002_reconnect.sql. */
  last_seen_at: string;
}

/** Never add token_hash / device_hash here: these rows feed the public state. */
export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, balance, joined_at, kick_requested_at, last_seen_at";
