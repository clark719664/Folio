const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixture = path.join(__dirname, "tagged.pdf");
execFileSync(path.join(root, "server/.venv/Scripts/python.exe"), [
  "-c",
  `import sys,pathlib;sys.path.insert(0,r'${path.join(root, "server")}');from test_accessibility import tagged_pdf;pathlib.Path(r'${fixture}').write_bytes(tagged_pdf())`,
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
    await page.getByRole("button", { name: "Tools", exact: true }).waitFor();
    async function inspect() {
      await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByLabel("Find a tool").fill("accessibility");
      await page
        .getByRole("button", { name: /Accessibility Inspect tags/ })
        .click();
      await page.getByLabel("Document language", { exact: true }).waitFor();
    }
    await inspect();
    await page
      .getByLabel("Accessibility document title")
      .fill("Accessible document");
    await page.getByLabel("Document language", { exact: true }).fill("en-US");
    let saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/accessibility") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save document properties", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await inspect();
    assert.equal(
      await page.getByLabel("Accessibility document title").inputValue(),
      "Accessible document",
    );
    assert.equal(
      await page.getByLabel("Document language", { exact: true }).inputValue(),
      "en-US",
    );
    const figure = page
      .locator(".structure-tree button")
      .filter({ hasText: /^Figure/ })
      .first();
    for (const detail of await page.locator(".structure-tree details").all())
      await detail.evaluate((element) => (element.open = true));
    await figure.click();
    await page
      .getByLabel("Alternative text", { exact: true })
      .fill("Diagram of the document workflow");
    saved = page.waitForResponse(
      (response) =>
        response.url().endsWith("/accessibility") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save structure element", exact: true })
      .click();
    const result = await saved;
    assert.equal(result.status(), 200, await result.text());
    const doc = await result.json();
    const report = await (
      await page.request.get(
        new URL(`/api/documents/${doc.id}/accessibility`, page.url()).href,
      )
    ).json();
    function flatten(nodes) {
      return nodes.flatMap((node) => [node, ...flatten(node.children)]);
    }
    assert.equal(
      flatten(report.tree).find((node) => node.role === "Figure").alt,
      "Diagram of the document workflow",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS accessible document properties and real structure-tree alternative text persisted through UI",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
