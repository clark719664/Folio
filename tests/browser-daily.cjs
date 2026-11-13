const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const fixture = path.join(__dirname, "daily.pdf");
execFileSync(path.join(__dirname, "../server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();p=d.new_page();p.insert_text((72,80),'First line\\nSecond line',fontsize=12);p.insert_text((72,150),'Next paragraph',fontsize=12);d.new_page().insert_text((72,80),'Page two');d.save(r'${fixture}')`,
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4320");
    await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
    await page.locator("input[type=file]").first().setInputFiles(fixture);
    await page.locator(".pdf-text-layer span").last().waitFor();
    const text = page.locator(".pdf-text-layer span").first();
    const bounds = await text.boundingBox();
    await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - 1,
      bounds.y + bounds.height / 2,
      { steps: 12 },
    );
    await page.mouse.up();
    assert.match(await page.evaluate(() => getSelection().toString()), /First/);
    await page.locator(".pdf-text-layer").evaluate((el) => {
      const range = document.createRange();
      range.setStart(el.firstElementChild.firstChild, 0);
      range.setEnd(
        el.lastElementChild.firstChild,
        el.lastElementChild.textContent.length,
      );
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    });
    await page.keyboard.press("Control+c");
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "First line\nSecond line\n\nNext paragraph",
    );
    await page.keyboard.press("PageDown");
    await page.locator('.pdf-text-layer span:text-is("Page two")').waitFor();
    await page.keyboard.press("Home");
    await page.locator('.pdf-text-layer span:text-is("First line")').waitFor();
    await page.keyboard.press("Control+-");
    await page.keyboard.press("Control+0");
    await page.waitForFunction(() => {
      const page = document.querySelector(".pdf-page"),
        viewport = document.querySelector(".page-scroll");
      return Math.abs(page.clientWidth - (viewport.clientWidth - 76)) < 3;
    });
    await page.getByRole("button", { name: "Edit text", exact: true }).click();
    await page.getByRole("button", { name: "First line", exact: true }).click();
    await page.getByLabel("Selected text").fill("Short edit");
    await page.keyboard.press("Home");
    assert.equal(
      await page.getByLabel("Selected text").inputValue(),
      "Short edit",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS daily viewer: native drag selection, paragraph clipboard, page shortcuts, true fit width, input keyboard guard.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
