const {
  chromium,
} = require("C:/Users/lil_c/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const base = process.env.FOLIO_URL || "http://127.0.0.1:4320";
const fixture = path.join(__dirname, "shared.pdf");
execFileSync(path.join(__dirname, "../server/.venv/Scripts/python.exe"), [
  "-c",
  `import pymupdf as f;d=f.open();p=d.new_page();p.insert_text((72,80),'Team review');d.save(r'${fixture}')`,
]);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Users/lil_c/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe",
  });
  const owner = await browser.newContext({
    viewport: { width: 1400, height: 950 },
  });
  const guest = await browser.newContext({
    viewport: { width: 1400, height: 950 },
  });
  const errors = [],
    stamp = Date.now(),
    password = "Shared-test-strong-password";
  const a = await owner.newPage(),
    b = await guest.newPage();
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    const credentialPath = path.join(
      __dirname,
      "../test-results/shared-browser-owner.json",
    );
    const savedCredentials = fs.existsSync(credentialPath)
      ? JSON.parse(fs.readFileSync(credentialPath, "utf8"))
      : null;
    const credentials = process.env.FOLIO_OWNER_USERNAME
      ? {
          username: process.env.FOLIO_OWNER_USERNAME || `owner${stamp}`,
          password: process.env.FOLIO_OWNER_PASSWORD || password,
          displayName: "Workspace Owner",
        }
      : savedCredentials || {
          username: `owner${stamp}`,
          password,
          displayName: "Workspace Owner",
        };
    const auth = await owner.request.post(
      `${base}/api/auth/${process.env.FOLIO_OWNER_USERNAME || savedCredentials ? "login" : "signup"}`,
      { data: credentials },
    );
    assert.equal(auth.status(), 200, await auth.text());
    assert.equal(
      (await auth.json()).user.workspaceOwner,
      true,
      "Use fresh isolated server storage or provide owner credentials",
    );
    fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
    fs.writeFileSync(credentialPath, JSON.stringify(credentials));
    const uploaded = await owner.request.post(`${base}/api/documents`, {
      multipart: {
        file: {
          name: "Shared review.pdf",
          mimeType: "application/pdf",
          buffer: fs.readFileSync(fixture),
        },
      },
    });
    assert.equal(uploaded.status(), 200, await uploaded.text());
    const local = await uploaded.json();
    await a.goto(base);
    await a.getByRole("button", { name: "Share", exact: true }).click();
    const created = await owner.request.post(`${base}/api/shared`, {
      data: { documentId: local.id, name: local.name },
    });
    assert.equal(created.status(), 200, await created.text());
    const shared = await created.json();
    await a.getByRole("button", { name: "Close shared workspace" }).click();
    await a.getByRole("button", { name: "Share", exact: true }).click();
    await a.locator(`[data-shared-id="${shared.id}"]`).click();
    await a.getByAltText("Shared PDF page 1").waitFor();
    await a.getByLabel("Invite permission").selectOption("viewer");
    await a
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    const cancelledLink = await a
      .getByLabel("One-use invitation link", { exact: true })
      .inputValue();
    await a
      .getByRole("button", { name: "Cancel viewer invitation 1", exact: true })
      .click();
    await a
      .getByRole("button", { name: "Cancel viewer invitation 1", exact: true })
      .waitFor({ state: "detached" });
    assert.equal(
      (
        await owner.request.post(`${base}/api/shared/join`, {
          data: { token: new URL(cancelledLink).searchParams.get("invite") },
        })
      ).status(),
      404,
    );
    await a.getByLabel("Invite permission").selectOption("commenter");
    await a
      .getByRole("button", { name: "Create invitation", exact: true })
      .click();
    const link = await a
      .getByLabel("One-use invitation link", { exact: true })
      .inputValue();
    await b.goto(link);
    await b
      .getByRole("button", { name: "Create an account", exact: true })
      .click();
    await b.getByLabel("Username", { exact: true }).fill(`guest${stamp}`);
    await b.getByLabel("Your name").fill("Review Partner");
    await b.getByLabel("Password", { exact: true }).fill(password);
    await b
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await b.getByAltText("Shared PDF page 1").waitFor();
    assert.equal(
      await b.getByRole("button", { name: "Rotate page", exact: true }).count(),
      0,
    );
    assert.equal(
      await b.getByRole("button", { name: "Edit text", exact: true }).count(),
      0,
    );
    const deniedEdit = await guest.request.post(
      `${base}/api/shared/${shared.id}/edit`,
      {
        data: {
          expectedVersion: shared.version,
          edit: { operation: "rotate", pages: [0], angle: 90 },
        },
      },
    );
    assert.equal(deniedEdit.status(), 403);
    for (const suffix of ["", "/file", "/pages/0/text", "/pages/0/render"]) {
      const denied = await guest.request.get(
        `${base}/api/documents/${local.id}${suffix}`,
      );
      assert.equal(denied.status(), 403);
    }
    const library = await guest.request.get(`${base}/api/library`);
    assert.equal(library.status(), 403);
    await b.getByLabel("Comment on page 1").fill("Please review the heading.");
    await b.getByRole("button", { name: "Post comment" }).click();
    await a
      .getByText("Please review the heading.", { exact: true })
      .waitFor({ timeout: 12000 });
    await a.getByRole("button", { name: "Rotate page", exact: true }).click();
    await b.waitForFunction(
      () => {
        const el = document.querySelector(".shared-paper");
        return (
          el &&
          el.getBoundingClientRect().width > el.getBoundingClientRect().height
        );
      },
      { timeout: 12000 },
    );
    const latest = await (
      await owner.request.get(`${base}/api/shared/${shared.id}`)
    ).json();
    assert.equal(latest.document.pages[0].rotation, 90);
    await b
      .getByLabel("Comment on page 1")
      .fill("Keep this draft through a conflict.");
    await a.getByRole("button", { name: "Rotate page", exact: true }).click();
    await a.waitForFunction(() => {
      const el = document.querySelector(".shared-paper");
      return (
        el &&
        el.getBoundingClientRect().width < el.getBoundingClientRect().height
      );
    });
    await b.getByRole("button", { name: "Post comment" }).click();
    await b.getByRole("button", { name: "Retry on latest version" }).waitFor();
    assert.equal(
      (
        await (
          await owner.request.get(`${base}/api/shared/${shared.id}`)
        ).json()
      ).comments.length,
      1,
    );
    await b.getByRole("button", { name: "Retry on latest version" }).click();
    await a
      .getByText("Keep this draft through a conflict.", { exact: true })
      .waitFor({ timeout: 12000 });
    await a
      .locator(".shared-presence")
      .filter({ hasText: "Review Partner" })
      .waitFor({ timeout: 15000 });
    await a
      .getByRole("button", { name: "Remove Review Partner", exact: true })
      .click();
    await b
      .getByRole("alert")
      .filter({ hasText: "Access to this shared PDF has ended" })
      .waitFor({ timeout: 12000 });
    assert.equal(await b.locator(".shared-paper").count(), 0);
    assert.equal(
      (
        await guest.request.get(`${base}/api/shared/${shared.id}/file`)
      ).status(),
      404,
    );
    const token = new URL(link).searchParams.get("invite");
    assert.equal(
      (
        await guest.request.post(`${base}/api/shared/join`, { data: { token } })
      ).status(),
      404,
    );
    const rejoinAs = async (role) => {
      await a.getByLabel("Invite permission").selectOption(role);
      const response = a.waitForResponse(
        (r) =>
          r.url().endsWith(`/shared/${shared.id}/invites`) &&
          r.request().method() === "POST",
      );
      await a
        .getByRole("button", { name: "Create invitation", exact: true })
        .click();
      const invitation = await (await response).json();
      await a.waitForFunction(
        (token) =>
          document
            .querySelector('input[aria-label="One-use invitation link"]')
            ?.value.includes(token),
        invitation.token,
      );
      const nextLink = await a
        .getByLabel("One-use invitation link", { exact: true })
        .inputValue();
      await b.goto(nextLink);
      await b.getByAltText("Shared PDF page 1").waitFor();
    };
    await rejoinAs("editor");
    await b.getByRole("button", { name: "Edit text", exact: true }).click();
    await b
      .getByRole("button", { name: "Edit Team review", exact: true })
      .click();
    await b.getByLabel("Replacement text").fill("Team final");
    await b.getByRole("button", { name: "Save text", exact: true }).click();
    await a
      .locator(".shared-paper .pdf-text-layer")
      .getByText("Team final", { exact: true })
      .waitFor({ timeout: 12000 });
    const sharedText = await (
      await owner.request.get(`${base}/api/shared/${shared.id}/pages/0/text`)
    ).json();
    assert.match(sharedText.text, /Team final/);
    assert.doesNotMatch(sharedText.text, /Team review/);
    const localText = await (
      await owner.request.get(`${base}/api/documents/${local.id}/pages/0/text`)
    ).json();
    assert.match(
      localText.text,
      /Team review/,
      "shared edit must not mutate local source",
    );
    await a
      .getByRole("button", { name: "Remove Review Partner", exact: true })
      .click();
    await b
      .getByRole("alert")
      .filter({ hasText: "Access to this shared PDF has ended" })
      .waitFor({ timeout: 12000 });
    await rejoinAs("viewer");
    assert.equal(
      await b.getByRole("button", { name: "Edit text", exact: true }).count(),
      0,
    );
    assert.equal(
      await b.getByRole("button", { name: "Highlight", exact: true }).count(),
      0,
    );
    assert.equal(
      await b
        .getByRole("button", { name: "Post comment", exact: true })
        .count(),
      0,
    );
    await b.getByText("You have view-only access.", { exact: true }).waitFor();
    const viewerState = await (
      await guest.request.get(`${base}/api/shared/${shared.id}`)
    ).json();
    assert.equal(
      (
        await guest.request.post(`${base}/api/shared/${shared.id}/comments`, {
          data: {
            expectedVersion: viewerState.version,
            text: "Forbidden",
            page: 0,
          },
        })
      ).status(),
      403,
    );
    assert.equal(
      (
        await guest.request.get(`${base}/api/shared/${shared.id}/file`)
      ).status(),
      200,
    );
    await a.reload();
    await a.getByRole("button", { name: "Share", exact: true }).click();
    await a.locator(`[data-shared-id="${shared.id}"]`).click();
    await a
      .getByText("Keep this draft through a conflict.", { exact: true })
      .waitFor();
    assert.equal(
      (await owner.request.get(`${base}/api/documents/${shared.id}`)).status(),
      404,
    );
    assert.equal(
      await b.evaluate(() =>
        JSON.stringify(localStorage).includes("Keep this draft"),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    await a.screenshot({
      path: path.join(__dirname, "shared-desktop.png"),
      fullPage: true,
    });
    await a.getByRole("button", { name: "Close shared workspace" }).click();
    await a.evaluate(
      (id) =>
        localStorage.setItem(
          "folio.document-session.v1",
          JSON.stringify({ documentId: id, page: 0, zoom: 1, fitWidth: true }),
        ),
      local.id,
    );
    await owner.clearCookies();
    await a.reload();
    await a.getByLabel("Username", { exact: true }).fill(credentials.username);
    await a.getByLabel("Password", { exact: true }).fill(credentials.password);
    await a.getByRole("button", { name: "Sign in", exact: true }).click();
    await a.getByRole("heading", { name: "Your shared PDFs" }).waitFor();
    await a.getByRole("button", { name: "Close shared workspace" }).click();
    await a.locator(".page-image").waitFor();
    assert.match(await a.locator(".filename").innerText(), /Shared review.pdf/);
    console.log(
      "PASS: isolated sessions, invitation join/cancel, editor text propagation, shared revisions/comments, presence, commenter and viewer enforcement, explicit conflict retry, revocation, persistence, source isolation, expired owner recovery",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
