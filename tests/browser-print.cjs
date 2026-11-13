const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "print.pdf");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();[(lambda p,i:p.insert_text((72,80),'Print page '+str(i)))(d.new_page(),i) for i in range(1,6)];d.save(r'${fixture}')`,
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
      .getByRole("button", { name: "Print page 1", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    assert.match(
      await page
        .getByRole("link", { name: "Open print preview", exact: true })
        .getAttribute("href"),
      /^\/api\/documents\//,
    );
    await page
      .getByRole("button", { name: "More actions", exact: true })
      .click();
    async function tool(name) {
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByLabel("Find a tool").fill(name);
      await page
        .locator(".tool-grid button")
        .filter({
          has: page.locator("b").filter({ hasText: new RegExp(`^${name}$`) }),
        })
        .click();
    }
    await tool("Print");
    const preview = await page
      .getByRole("link", { name: "Open print preview", exact: true })
      .getAttribute("href");
    const originalPreview = await page.request.get(
      new URL(preview, page.url()).href,
    );
    assert.equal(originalPreview.status(), 200);
    assert.match(originalPreview.headers()["content-disposition"], /^inline/);
    await page.getByLabel("Print layout").selectOption("nup");
    await page.getByLabel("Print columns").fill("2");
    await page.getByLabel("Print rows").fill("1");
    await page.getByLabel("Print pages", { exact: true }).fill("1-3");
    let responseEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/impose") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Prepare print layout", exact: true })
      .click();
    let response = await responseEvent;
    assert.equal(response.status(), 200, await response.text());
    let result = await response.json();
    assert.equal(result.pageCount, 2);
    assert.deepEqual(result.sheets, [[0, 1], [2]]);
    await page
      .getByRole("heading", { name: "2 sheet sides", exact: true })
      .waitFor();
    await page.getByLabel("Print layout").selectOption("booklet");
    await page.getByLabel("Print pages", { exact: true }).fill("");
    responseEvent = page.waitForResponse(
      (response) =>
        response.url().endsWith("/impose") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Prepare print layout", exact: true })
      .click();
    response = await responseEvent;
    assert.equal(response.status(), 200, await response.text());
    result = await response.json();
    assert.equal(result.pageCount, 4);
    assert.deepEqual(result.sheets, [
      [null, 0],
      [1, null],
      [null, 2],
      [3, 4],
    ]);
    await page
      .getByRole("heading", { name: "4 sheet sides", exact: true })
      .waitFor();
    await page.screenshot({ path: path.join(__dirname, "print-layout.png") });
    await page
      .getByRole("button", { name: "Close tools", exact: true })
      .click();
    await tool("Print production");
    const checked = page.waitForResponse(
      (response) =>
        response.url().endsWith("/preflight") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Run preflight", exact: true })
      .click();
    const report = await (await checked).json();
    assert.equal(report.conformanceCertified, false);
    assert.ok(
      report.findings.some((finding) => finding.kind === "font-embedded"),
    );
    await page
      .getByRole("heading", { name: "Issues found", exact: true })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS inline print preview, n-up page order, booklet padding and preflight findings through UI",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
