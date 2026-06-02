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
  await expect(page.getByText("receiving")).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByLabel("latest frames")).toContainText("No frames");

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("display live")).toBeVisible();
});

test("parser preview can load and parse sample signals headlessly", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Parser" }).click();
  await expect(page.getByLabel("parser workspace")).toBeVisible();

  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByLabel("parser workspace")).toContainText("4 signals");

  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.getByLabel("parser workspace")).toContainText("4 sample(s), 4 point(s) preview");
  await expect(page.getByLabel("parser workspace")).toContainText("motor0_rps");
});

test("plotter layout can be loaded and series can be selected headlessly", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Plotter" }).click();
  await expect(page.getByLabel("plotter workspace")).toBeVisible();

  await page.getByRole("button", { name: "Load" }).click();
  await expect(page.getByLabel("plotter workspace")).toContainText("4 series");
  await expect(page.getByLabel("plotter workspace")).toContainText("X Axis");
  await expect(page.getByLabel("plotter workspace")).toContainText("Legend");
  await expect(page.getByLabel("plotter workspace")).not.toContainText("Capture CSV");
  await expect(page.getByLabel("plotter workspace")).not.toContainText("Selected");

  await page.getByRole("checkbox").nth(2).check();
  await page.getByLabel("Motor0 angle color").selectOption("#F5774D");
  await page.getByRole("button", { name: /Motor0 angle/ }).click();
  await expect(page.getByLabel("plotter workspace")).toContainText("orion_motor0_angle_rad");
  await expect.poll(async () => page.getByLabel("Motor0 angle color").inputValue()).toBe("#F5774D");
  await expect(page.getByLabel("plotter workspace")).toContainText("Current Values");
  await expect(page.getByLabel("plotter workspace")).toContainText(/orion_motor0_angle_rad[\s\S]*rad/);
});
