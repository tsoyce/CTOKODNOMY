import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const url = new URL(process.env.SITE_ORIGIN);
assert.equal(url.protocol, "https:");
assert.equal(url.pathname, "/");
assert.equal(url.username + url.password + url.search + url.hash, "");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url.origin, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("main", { timeout: 15000 });
  assert.match(await page.locator("body").innerText(), /100 к 1/);
  const site = await (await page.request.get(`${url.origin}/api/site`)).json();
  if (!site.initialized) {
    await page.goto(`${url.origin}/setup`, { waitUntil: "networkidle" });
    await page.waitForSelector("input");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  console.log("::notice title=Live browser verification::Public HTTPS, React rendering, first setup and mobile layout verified without skipping certificate verification.");
} finally {
  await browser.close();
}
