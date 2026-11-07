# webBarbutGame

Barbut cu zaruri, jucat în doi, cu până la 5 chibiți (spectatori) care pot paria **Șan** și **Brăila**.
Același stil și arhitectură ca Bingo: Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast), deploy pe Vercel.
Face parte din hub-ul [games.hailatat.icu](https://games.hailatat.icu).

## Reguli („barbut curat”)

1. Doi jucători stau la masă. Creatorul camerei ia primul loc; al doilea intră cu codul camerei.
2. Pe rând, cel care are zarurile apasă **Aruncă**. Zarurile se dau pe server (`crypto.randomInt`), nu în browser.
3. **Câștigă** aruncătorul pe 6-6, 5-5, 3-3, 6-5. **Pierde** pe 1-1, 2-2, 4-4, 1-2 (5/36 fiecare, joc corect).
4. Orice altă aruncare e neutră: zarurile trec la adversar.
5. Mâna se termină la prima aruncare decisivă. Câștigătorul ia miza de la celălalt și ține zarurile la mâna următoare.
6. Se joacă pe **jetoane virtuale** (soldul poate fi negativ). Fără bani reali.

### Chibiți (spectatori)

- Până la **5 chibiți** pe cameră. Pot intra oricând, și în mijlocul unei mâini.
- **Brăila**: chibițul ține cu unul din cei doi jucători. Câștigă sau pierde miza odată cu el la finalul mâinii.
  Un pariu Brăila pe mână.
- **Șan**: pariu „pe mâna” celui care are zarurile, doar pe următoarea lui aruncare. Câștigătoare = câștigă,
  pierzătoare = pierde, neutră = se anulează. Nu depinde de zarul adversarului.
- Între mâini, un chibiț poate lua un loc liber la masă, iar un jucător se poate ridica și deveni chibiț.

### Extra

- Dacă un jucător pleacă (sau e scos) în timpul mâinii, mâna se anulează (pariurile deschise devin „anulat”)
  și cel mai vechi chibiț îi ia locul.
- Host-ul poate schimba miza între mâini și poate scoate pe oricine din cameră.
- Camerele fără mână în curs se închid după 10 minute în care nimeni nu le are deschise; cele cu mână în curs după 30 de minute.

## Arhitectură, pe scurt

- Toată logica rulează în Route Handlers (`src/app/api/rooms/...`) cu **service role key**, doar pe server.
- Tabelele (`barbut_rooms`, `barbut_players`, `barbut_throws`, `barbut_bets`) au **RLS activat și nicio policy**, plus
  `revoke` pentru `anon`/`authenticated`. Stau în același proiect Supabase cu Bingo, cu prefixul `barbut_`.
- Live: după fiecare modificare serverul trimite un semnal Realtime Broadcast pe `barbut-room:<uuid>`; clientul face
  refetch la `/api/rooms/<cod>/state`. Polling la 15 s ca rezervă.
- Concurență: aruncarea „revendică” slotul cu un `update ... where throw_count = n`, deci dublu-tap sau două taburi
  nu pot arunca de două ori. Pariurile verifică după insert că zarurile nu au fost aruncate între timp.

## Setup

1. În Supabase SQL editor rulează `supabase/schema.sql` (idempotent).
2. Copiază `.env.example` în `.env.local` și completează cheile.
3. `npm install`, apoi `npm run dev`.
4. Pe Vercel setează aceleași 3 variabile de mediu.

Teste: `npm test`, `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
