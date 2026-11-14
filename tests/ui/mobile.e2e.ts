// Scenario 3 (phone only): no screen may scroll sideways (home, waiting room, a round in progress), the main
// buttons must be big enough to tap (WCAG 2.2 minimum target 24 x 24 CSS px; ours aim at 44), and a real touch tap
// on "Aruncă zarurile" must throw, with the other phone seeing it live. Scenario 1 already plays a full round on the
// emulated iPhone; this one checks the layout.
import { expect, test, type Locator } from "@playwright/test";
import {
  createRoom,
  currentThrower,
  expectNoHorizontalScroll,
  joinRoom,
  leaveAll,
  REALTIME_MS,
  throwCount,
  throwDice,
  withPlayers,
} from "./helpers";

const MIN_TAP_PX = 24;

async function expectTappable(button: Locator, what: string) {
  const box = await button.boundingBox();
  expect(box, `${what} has a box`).not.toBeNull();
  expect(Math.min(box!.width, box!.height), `${what} size`).toBeGreaterThanOrEqual(MIN_TAP_PX);
}

test("the screens fit a phone and a touch tap throws", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectTappable(host.page.getByTestId("home-submit"), "create button");
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("the room between rounds fits the screen", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(host.page.getByTestId("start-round")).toBeVisible({ timeout: REALTIME_MS });
      for (const p of players) {
        await expectNoHorizontalScroll(p.page);
        await expectTappable(p.page.getByTestId("start-round"), `${p.name}'s start button`);
        await expectTappable(p.page.getByTestId("leave"), `${p.name}'s leave button`);
      }
    });

    await test.step("a round in progress fits the screen, the throw button is big enough", async () => {
      await host.page.getByTestId("start-round").tap();
      await expect(guest.page.getByTestId("turn-info")).toBeVisible({ timeout: REALTIME_MS });
      for (const p of players) await expectNoHorizontalScroll(p.page);
      await expectTappable(host.page.getByTestId("throw-button"), "throw button");
    });

    await test.step("a touch tap throws, the other phone sees it live", async () => {
      const thrower = await currentThrower(players);
      const before = await throwCount(thrower);
      await throwDice(thrower, room.code, true); // a touch tap, not a mouse click
      for (const p of players) {
        await expect(p.page.getByTestId("dice-area")).toHaveAttribute("data-throw-count", String(before + 1), {
          timeout: REALTIME_MS,
        });
        await expectNoHorizontalScroll(p.page);
      }
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
