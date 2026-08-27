import { test, expect } from "@playwright/test";

// Phase F6: the golden path, driven against the real demo-connector stack
// (both dev servers, real API calls, zero third-party credentials) rather
// than mocks — register -> connect a demo platform -> feed loads -> compose
// + publish -> publish history shows it. A fresh email every run so this
// is safe to run repeatedly against the same dev database.

test("golden path: register, connect, feed, compose, history", async ({ page }) => {
  const email = `e2e-smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}@nexus.app`;
  const password = "e2e-smoke-password1";
  const postContent = `E2E smoke test post ${Date.now()}`;

  await test.step("register", async () => {
    await page.goto("/register");
    await page.getByLabel("Display name").fill("E2E Smoke");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/dashboard");
  });

  await test.step("connect a demo platform", async () => {
    await page.goto("/dashboard/connections");
    // Twitter defaults to selected and needs no credential in demo mode,
    // keeping this the simplest platform to drive end-to-end.
    await page.getByRole("button", { name: "Twitter / X", exact: true }).click();
    await page.getByPlaceholder("@you").fill("@e2esmoke");
    await page.getByRole("button", { name: /^Connect Twitter/ }).click();
    await expect(page.getByText(/Connected Twitter \/ X!/)).toBeVisible({ timeout: 10_000 });
  });

  await test.step("feed loads imported posts", async () => {
    await page.goto("/dashboard/feed");
    await expect(page.locator("article").first()).toBeVisible({ timeout: 10_000 });
  });

  await test.step("like a post and have it stick", async () => {
    // Regression guard for the body-less-POST bug: the web client used to
    // send Content-Type: application/json with an empty body on
    // like/bookmark/logout, which Fastify 400s — the optimistic like then
    // silently rolled back (and, post-F3, raised an error toast). A real
    // like click must persist, not revert.
    const firstArticle = page.locator("article").first();
    const likeButton = firstArticle.getByRole("button", { name: /like/i }).first();
    await likeButton.click();
    await expect(page.getByText(/Couldn't update like/)).toHaveCount(0);
    await page.reload();
    await expect(page.locator("article").first().getByRole("button", { name: /unlike/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  await test.step("compose and publish a post", async () => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "New post" }).click();
    await page.getByPlaceholder("What's happening?").fill(postContent);
    await page.getByRole("button", { name: /^Post to \d+ platform/ }).click();
    await expect(page.getByText("Publishing results")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Posted in/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  });

  await test.step("publish history shows the new post", async () => {
    await page.goto("/dashboard");
    await expect(page.getByText(postContent)).toBeVisible({ timeout: 10_000 });
  });
});
