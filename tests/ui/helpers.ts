// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// Barbut is random (dice): the tests never hard-code a result, they read whose turn it is from the screen.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 15 s. */
export const REALTIME_MS = 5_000;
export const PASSWORD = "pw";
/** A round ends at the first decisive throw (10 of 36 outcomes): 60 throws without one is practically impossible. */
const MAX_THROWS = 60;

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  return { name, context, page: await context.newPage() };
}

/** Host creates a password-protected room from the home page (takes seat A); returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Parolă (opțional)").fill(PASSWORD);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("seat-a")).toContainText(host.name);
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins with the player's nickname (takes the free seat, or becomes a spectator). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByLabel("Parolă (dacă are camera)").fill(PASSWORD);
  await p.page.getByTestId("join-submit").click();
  await expect(p.page.getByTestId("join-submit")).toBeHidden();
  await expect(p.page.getByTestId("dice-area")).toBeVisible();
}

/** Number of throws of the current round, as the screen shows it. */
export async function throwCount(p: Player): Promise<number> {
  return Number(await p.page.getByTestId("dice-area").getAttribute("data-throw-count"));
}

/** The seated player whose screen shows the throw button (waits until one does). */
export async function currentThrower(players: Player[]): Promise<Player> {
  let found: Player | undefined;
  await expect
    .poll(
      async () => {
        // Exactly one screen may show the button (a stale one right after a neutral throw does not count).
        const visible: Player[] = [];
        for (const p of players) if (await p.page.getByTestId("throw-button").isVisible()) visible.push(p);
        found = visible.length === 1 ? visible[0] : undefined;
        return found?.name ?? "";
      },
      { timeout: REALTIME_MS },
    )
    .not.toBe("");
  return found!;
}

/** Clicks "Aruncă zarurile" on the thrower's screen and waits for the server to accept it. */
export async function throwDice(thrower: Player, code: string, tap = false): Promise<void> {
  const button = thrower.page.getByTestId("throw-button");
  await expect(button).toBeEnabled({ timeout: REALTIME_MS });
  await Promise.all([
    thrower.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/throw`) && r.ok()),
    tap ? button.tap() : button.click(),
  ]);
}

/**
 * Plays the round to its end: whoever has the throw button throws; every throw must reach every other screen
 * (players and `watchers`) live, and a neutral throw must pass the dice to the other player. Returns the winner.
 */
export async function playRound(players: Player[], code: string, watchers: Player[] = []): Promise<Player> {
  for (let i = 0; i < MAX_THROWS; i++) {
    const thrower = await currentThrower(players);
    const before = await throwCount(thrower);
    await throwDice(thrower, code);
    for (const p of [...players, ...watchers]) {
      await expect(p.page.getByTestId("dice-area")).toHaveAttribute("data-throw-count", String(before + 1), {
        timeout: REALTIME_MS,
      });
    }
    // The dice animation takes 650 ms; then either the round is over or the other player has the dice.
    const winnerBanner = thrower.page.getByTestId("round-winner");
    const other = players.find((p) => p !== thrower)!;
    await expect
      .poll(async () => (await winnerBanner.isVisible()) || (await other.page.getByTestId("throw-button").isVisible()), {
        timeout: REALTIME_MS,
      })
      .toBe(true);
    if (await winnerBanner.isVisible()) {
      const text = (await winnerBanner.textContent()) ?? "";
      return text.includes("Ai câștigat") ? thrower : other;
    }
  }
  throw new Error(`no decisive throw in ${MAX_THROWS} throws`);
}

/** Leaves through "Părăsește camera" (accepting the confirm), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    p.page.once("dialog", (d) => void d.accept());
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/barbut_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
