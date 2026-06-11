import { expect, test } from "@playwright/test";

test("monitor preview shows dummy frames without Tauri", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "CANRush" })).toBeVisible();
  await expect(page.getByLabel("local server status")).toContainText("canrush-server-preview");
  await expect(page.getByRole("button", { name: "Start Server" })).toHaveCount(0);

  await page.getByLabel("Dummy data").check();
  await expect(page.getByLabel("latest frames")).toContainText("0x200");
  await expect(page.getByLabel("latest frames")).toContainText("CAN0");
});

test("monitor toolbar can start connect clear and disconnect headlessly", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("local server status")).toContainText("canrush-server-preview");

  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("receiving", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByLabel("latest frames")).toContainText("No frames");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("display live")).toBeVisible();
});

test("desktop is limited to the receive monitor", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Parser" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plotter" })).toHaveCount(0);
  await expect(page.getByLabel("latest frames")).toBeVisible();
  await expect(page.getByLabel("main actions")).toContainText("Refresh");
  await expect(page.getByLabel("main actions")).toContainText("Connect");
  await expect(page.getByLabel("main actions")).toContainText("Disconnect");
  await expect(page.getByRole("button", { name: "Capture CSV" })).toHaveCount(0);
});
