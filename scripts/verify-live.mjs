import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const url = new URL(process.env.SITE_ORIGIN);
assert.equal(url.protocol, "https:");
assert.equal(url.pathname, "/");
assert.equal(url.username + url.password + url.search + url.hash, "");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const siteResponse = await page.request.get(`${url.origin}/api/site`);
  assert.equal(siteResponse.ok(), true);
  const site = await siteResponse.json();
  await page.goto(url.origin, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("main", { timeout: 15000 });
  assert.equal(
    (await page.locator("body").innerText()).includes(site.brand.title),
    true,
  );
  if (!site.initialized) {
    await page.waitForURL(`${url.origin}/setup`, { timeout: 15000 });
    await page.waitForSelector("input");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const game = site.games[0];
  if (game) {
    await page.goto(`${url.origin}/board/${encodeURIComponent(game.id)}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForSelector(".board-page");
    await page.setViewportSize({ width: 1280, height: 720 });
    const projector = page.getByRole("button", { name: "Для проектора" });
    if ((await projector.getAttribute("aria-pressed")) !== "true")
      await projector.click();
    assert.equal(
      await page.locator(".board-page").getAttribute("data-projector"),
      "true",
    );
    assert.equal(
      await page.locator(".board-page").evaluate(
        (element) => getComputedStyle(element).getPropertyValue("--bg").trim(),
      ),
      "#ffffff",
    );
    const results = await page.request.get(
      `${url.origin}/api/games/${encodeURIComponent(game.id)}/results`,
    );
    assert.equal(results.status(), game.resultsAvailable ? 200 : 404);
    await page.goto(`${url.origin}/results/${encodeURIComponent(game.id)}`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForSelector(
      game.resultsAvailable ? ".results-page" : ".results-unavailable",
    );
    if (!game.resultsAvailable)
      assert.equal(await page.locator(".round-statistics").count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log(
    "::notice title=Live browser verification::Public HTTPS, React rendering, mobile layout and available game/projector/results pages verified without skipping certificate verification.",
  );
} finally {
  await browser.close();
}
