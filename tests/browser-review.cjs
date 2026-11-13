const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "review.pdf");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();p=d.new_page();p.insert_text((72,80),'Review document');d.save(r'${fixture}')`,
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
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(process.env.FOLIO_URL || "http://127.0.0.1:4320");
    await page.getByRole("button", { name: "Open PDF", exact: true }).waitFor();
    await page.locator("input[type=file]").first().setInputFiles(fixture);
    await page
      .locator(
        '[aria-label="Review document"], .pdf-text-layer span:text-is("Review document")',
      )
      .waitFor();
    async function tool(label) {
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("textbox", { name: "Find a tool" }).fill(label);
      await page
        .locator(".tool-grid button")
        .filter({
          has: page.locator("b", { hasText: new RegExp(`^${label}$`) }),
        })
        .click();
    }
    async function save(button, endpoint) {
      const pending = page.waitForResponse(
        (response) =>
          response.url().endsWith(endpoint) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: button, exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200, await response.text());
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      return response.json();
    }
    await tool("Comments");
    await page.getByLabel("Comment author").fill("Reviewer");
    await page.getByLabel("Comment text").fill("Please verify this section.");
    await save("Add comment", "/comments");
    await tool("Comments");
    await page
      .getByText("Please verify this section.", { exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await page.getByLabel("Comment text").fill("Verified against the source.");
    await save("Post reply", "/comments");
    await tool("Comments");
    const parent = page.locator(".review-item").filter({
      has: page
        .locator("p")
        .filter({ hasText: /^Please verify this section\.$/ }),
    });
    const resolve = page.waitForResponse(
      (response) =>
        response.url().endsWith("/comments") &&
        response.request().method() === "POST",
    );
    await parent.getByRole("button", { name: "Resolve", exact: true }).click();
    const resolved = await (await resolve).json();
    const result = await (
      await page.request.get(
        new URL(`/api/documents/${resolved.id}/comments`, page.url()).href,
      )
    ).json();
    assert.equal(result.comments.length, 2);
    assert.equal(
      result.comments.find((item) => item.text.startsWith("Please")).resolved,
      true,
    );
    assert.ok(
      result.comments.find((item) => item.text.startsWith("Verified")).replyTo,
    );
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await tool("Measurements");
    await page.getByLabel("Measurement points").fill("72, 72\n144, 72");
    await page.getByLabel("Units per PDF point").fill(String(1 / 72));
    await page.getByLabel("Measurement unit", { exact: true }).fill("in");
    await page.getByLabel("Measurement label").fill("One inch");
    const measured = await save("Save measurement", "/measurements");
    const measurementResponse = await page.request.get(
      new URL(`/api/documents/${measured.id}/measurements`, page.url()).href,
    );
    const measurement = (await measurementResponse.json()).measurements[0];
    assert.equal(measurement.value, 1);
    assert.equal(measurement.unit, "in");
    await tool("Measurements");
    await page.getByText("One inch · 1 in", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(__dirname, "measurements.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS persisted comment/reply/resolve relationships and calibrated measurement through UI",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
