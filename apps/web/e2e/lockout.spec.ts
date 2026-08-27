import { test, expect } from "@playwright/test";

// Phase B6: the login page surfaces a 423 lockout's retryAfterSeconds as a
// live countdown with the submit button disabled — not a static error the
// user can hammer.
//
// The 423 is injected via route interception rather than by genuinely
// tripping the lockout: the lockout mechanics themselves (5 failures →
// 423 + retryAfterSeconds, checked before the password compare) are
// covered by the API suite (auth.test.ts), and really failing 6 logins
// here would eat 6 of the per-IP login rate limit's 10/min — making this
// spec and any same-minute re-run (CI retries) flake against each other.
// This spec owns exactly what the API suite can't: the browser-side
// countdown contract.

test("account lockout shows a live countdown and disables login", async ({ page }) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 423,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Too many failed login attempts. Please try again later.",
        retryAfterSeconds: 30,
      }),
    }),
  );

  await page.goto("/login");
  await page.getByLabel("Email").fill("locked-out@nexus.app");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText(/Account temporarily locked/)).toBeVisible();
  const countdown = page.locator("span.tabular-nums").first();
  const first = Number((await countdown.textContent())?.replace(/\D/g, ""));
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(30);

  // The button is disabled and labeled with the remaining time.
  await expect(page.getByRole("button", { name: /Locked \(\d+s\)/ })).toBeDisabled();

  // It's a LIVE countdown: the number goes down.
  await page.waitForTimeout(2100);
  const later = Number((await countdown.textContent())?.replace(/\D/g, ""));
  expect(later).toBeLessThan(first);
});
