// Scenario 2: someone opens the invite link while a round is running. They become a spectator ("chibiț": no throw or
// start buttons, a bet panel), the players see them live, their Șan and Brăila bets show up on the players' screens,
// they see every throw live, queue for the table ("coadă #1" seen by the players), see the end of the round and its
// bets settled, and when a player leaves the queued spectator takes the free seat and can start the next round.
// Desktop Chromium only: it checks game logic and Realtime, the device does not matter (scenario 1 runs on WebKit too).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playRound, REALTIME_MS, withPlayers } from "./helpers";

test("a late joiner watches, bets, queues and takes a free seat", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, spectator] = players;
    const sp = spectator.page;

    await test.step("two players start a round", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(host.page.getByTestId("start-round")).toBeVisible({ timeout: REALTIME_MS });
      await host.page.getByTestId("start-round").click();
      await expect(guest.page.getByTestId("turn-info")).toContainText(`Aruncă ${host.name}`, { timeout: REALTIME_MS });
    });

    await test.step("a third person joins mid-round and becomes a spectator", async () => {
      await joinRoom(spectator, room.code);
      await expect(sp.getByTestId("bet-panel")).toBeVisible();
      for (const id of ["throw-button", "start-round", "stand-up"]) await expect(sp.getByTestId(id)).toHaveCount(0);
      await expect(sp.getByTestId("people-list")).toContainText(`${spectator.name} (tu)`);
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("people-list")).toContainText(spectator.name, { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("room-status")).toContainText("· 1 chibiț ·");
      }
    });

    await test.step("the spectator bets Brăila and Șan, the players see both live", async () => {
      await Promise.all([
        sp.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/bet`) && r.ok()),
        sp.getByTestId("bet-braila").filter({ hasText: host.name }).click(),
      ]);
      await expect(sp.getByTestId("bet-panel")).toContainText(`Ai Brăila pe ${host.name}`);
      await Promise.all([
        sp.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/bet`) && r.ok()),
        sp.getByTestId("bet-san").click(),
      ]);
      await expect(sp.getByTestId("bet-panel")).toContainText("Ai Șan pe mâna lui");
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("bet-list").locator("li")).toHaveCount(2, { timeout: REALTIME_MS });
        await expect(p.page.getByTestId("bet-list")).toContainText(`Brăila pe ${host.name}`);
      }
    });

    await test.step("the spectator queues for the table, the players see it live", async () => {
      await sp.getByTestId("queue-toggle").click();
      await expect(sp.getByTestId("queue-toggle")).toContainText("În coadă (#1)");
      for (const p of [host, guest]) {
        await expect(p.page.getByTestId("people-list")).toContainText("coadă #1", { timeout: REALTIME_MS });
      }
    });

    const winner = await test.step("the round is played; the spectator sees every throw live", () =>
      playRound([host, guest], room.code, [spectator]),
    );

    await test.step("the spectator sees the end of the round and the bets settled", async () => {
      await expect(sp.getByTestId("round-winner")).toContainText(`${winner.name} câștigă mâna`, { timeout: REALTIME_MS });
      await expect(sp.getByTestId("bet-panel")).toHaveCount(0);
      // The Brăila follows the winner; the Șan was decided (or voided) by the first throw after it.
      const braila = sp.getByTestId("bet-list").locator("li", { hasText: "Brăila" });
      await expect(braila).toHaveAttribute("data-status", winner === host ? "won" : "lost");
      await expect(sp.getByTestId("bet-list").locator('li[data-status="open"]')).toHaveCount(0);
    });

    await test.step("the guest leaves: the queued spectator takes the seat and starts round 2", async () => {
      await leaveAll([guest]);
      await expect(sp.getByTestId("seat-b")).toContainText(`${spectator.name} (tu)`, { timeout: REALTIME_MS });
      await expect(host.page.getByTestId("seat-b")).toContainText(spectator.name, { timeout: REALTIME_MS });
      await expect(sp.getByTestId("queue-toggle")).toHaveCount(0);
      await sp.getByTestId("start-round").click();
      await expect(host.page.getByTestId("room-status")).toContainText("Mâna 2", { timeout: REALTIME_MS });
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([spectator, host]);
      room.closed = true;
    });
  });
});
