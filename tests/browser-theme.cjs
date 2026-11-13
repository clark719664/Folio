const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fixture = path.join(__dirname, "theme.pdf");
execFileSync(path.join(__dirname, "../server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();p=d.new_page();p.insert_text((72,80),'Appearance test');d.save(r'${fixture}')`,
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme: "light",
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4320");
    await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
    await page.locator("input[type=file]").first().setInputFiles(fixture);
    await page.locator(".page-image").waitFor();
    const choose = async (name) => {
      if (!(await page.getByRole("radio", { name, exact: true }).isVisible()))
        await page
          .getByRole("button", { name: "More actions", exact: true })
          .click();
      await page.getByRole("radio", { name, exact: true }).click();
    };
    const theme = async (value) =>
      page.waitForFunction(
        (v) => document.documentElement.dataset.theme === v,
        value,
      );
    await choose("Dark");
    await theme("dark");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("folio.appearance.v1")),
      "dark",
    );
    await page.reload();
    await theme("dark");
    await page.locator(".page-image").waitFor();
    assert.equal(
      await page
        .locator(".pdf-page")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      "rgb(255, 255, 255)",
    );
    assert.equal(
      await page
        .locator(".page-image")
        .evaluate((el) => getComputedStyle(el).filter),
      "none",
    );
    await page.locator(".page-image").evaluate(async (img) => {
      await img.decode();
    });
    const originalPixels = await page.locator(".page-image").evaluate((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL();
    });
    const paperBounds = await page.locator(".page-image").boundingBox();
    const textClip = {
      x: paperBounds.x + 30,
      y: paperBounds.y + 30,
      width: 300,
      height: 100,
    };
    const darkRendered = await page.screenshot({ clip: textClip });
    await page.screenshot({ path: "tests/theme-dark.png" });
    const dark = await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({ colorScheme: "light" });
    await theme("dark");
    await choose("Light");
    await theme("light");
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    assert.notEqual(
      await page
        .locator(".sidebar")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      dark,
    );
    await page.locator(".page-image").evaluate(async (img) => {
      await img.decode();
    });
    assert.equal(
      await page.locator(".page-image").evaluate((img) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        return canvas.toDataURL();
      }),
      originalPixels,
    );
    const lightRendered = await page.screenshot({ clip: textClip });
    assert.ok(
      lightRendered.equals(darkRendered),
      "Rendered PDF text area is identical in both themes",
    );
    await page.screenshot({ path: "tests/theme-light.png" });
    await page.reload();
    await theme("light");
    await choose("System");
    await theme("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await theme("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await theme("light");
    await page.reload();
    await theme("light");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("folio.appearance.v1")),
      "system",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS appearance: Light/Dark/System, persistence, live system change, unchanged PDF paper, screenshots.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
