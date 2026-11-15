// Scenario 1: two real browsers play live on the deployed site: create (password), join by link, start, a full round
// thrown from the screens (whoever has the dice throws), every throw reaches the other screen through Realtime (well
// under the 60 s polling fallback), the winner banner and balances, a second round started by the other side and
// followed live, leave. Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playRound, REALTIME_MS, withPlayers } from "./helpers";

const STAKE = 10; // default stake of a new room

test("two players play a live round to a winner", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room, the guest joins by link and takes seat B", async () => {
      room.code = await createRoom(host);
      await expect(host.page.getByTestId("start-round")).toHaveCount(0);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("seat-b")).toContainText(`${guest.name} (tu)`);
      await expect(host.page.getByTestId("seat-b")).toContainText(guest.name, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("start-round")).toBeVisible();
    });

    await test.step("host starts round 1, seat A has the dice, the guest sees it live", async () => {
      await host.page.getByTestId("start-round").click();
      await expect(host.page.getByTestId("throw-button")).toBeVisible();
      await expect(host.page.getByTestId("room-status")).toContainText("Mâna 1");
      await expect(guest.page.getByTestId("room-status")).toContainText("Mâna 1", { timeout: REALTIME_MS });
      await expect(guest.page.getByTestId("turn-info")).toContainText(`Aruncă ${host.name}`);
      await expect(guest.page.getByTestId("throw-button")).toHaveCount(0);
    });

    const winner = await test.step("play the round, every throw live on the other screen", () => playRound(players, room.code));
    const loser = winner === host ? guest : host;

    await test.step("both see the winner and the stake moved", async () => {
      await expect(winner.page.getByTestId("round-winner")).toContainText("Ai câștigat mâna!");
      await expect(loser.page.getByTestId("round-winner")).toContainText(`${winner.name} câștigă mâna`, { timeout: REALTIME_MS });
      const seatOf = (p: typeof host) => (p === host ? "seat-a" : "seat-b");
      for (const p of players) {
        await expect(p.page.getByTestId(seatOf(winner))).toContainText(`+${STAKE}`);
        await expect(p.page.getByTestId(seatOf(loser))).toContainText(`-${STAKE}`);
      }
      await expect(host.page.getByTestId("throw-history").locator("li")).toHaveCount(
        Number(await host.page.getByTestId("dice-area").getAttribute("data-throw-count")),
      );
    });

    await test.step("the guest starts round 2, the winner keeps the dice, the host follows live", async () => {
      await guest.page.getByTestId("start-round").click();
      await expect(guest.page.getByTestId("room-status")).toContainText("Mâna 2");
      await expect(host.page.getByTestId("room-status")).toContainText("Mâna 2", { timeout: REALTIME_MS });
      await expect(winner.page.getByTestId("throw-button")).toBeVisible({ timeout: REALTIME_MS });
      await expect(loser.page.getByTestId("turn-info")).toContainText(`Aruncă ${winner.name}`, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("dice-area")).toHaveAttribute("data-throw-count", "0");
    });

    await test.step("the guest leaves mid-round (round cancelled), then the host, the room closes", async () => {
      await leaveAll([guest]);
      await expect(host.page.getByTestId("seat-b")).toContainText("Loc liber", { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("room-status")).toContainText("Pauză");
      await leaveAll([host]);
      room.closed = true;
    });
  });
});
