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

test("plotter live preview draws points in headless browser mode", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Plotter" }).click();
  await expect(page.getByLabel("plotter workspace")).toBeVisible();
  await expect(page.getByRole("img", { name: "plot preview" })).toBeVisible();

  await page.getByRole("button", { name: "Live" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByLabel("plotter workspace")).toContainText("running");
  await expect(page.getByLabel("plotter workspace")).toContainText(/4 sample\(s\), 4 point\(s\) live/);
  await expect(page.getByText(/last 10s \/ [1-9]\d* point\(s\)/)).toBeVisible();
  await expect(page.getByText(/last 10s \/ ([5-9]|\d{2,}) point\(s\)/)).toBeVisible();
  await expect
    .poll(async () =>
      page.getByRole("img", { name: "plot preview" }).evaluate((canvas) => {
        const context = (canvas as HTMLCanvasElement).getContext("2d");
        if (!context) {
          return 0;
        }
        const { width, height } = canvas as HTMLCanvasElement;
        const pixels = context.getImageData(0, 0, width, height).data;
        let coloredPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index];
          const green = pixels[index + 1];
          const blue = pixels[index + 2];
          if (Math.max(red, green, blue) - Math.min(red, green, blue) > 30) {
            coloredPixels += 1;
          }
        }
        return coloredPixels;
      }),
    )
    .toBeGreaterThan(0);
});

test("plotter csv preview can be cleared headlessly", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Plotter" }).click();
  await expect(page.getByLabel("plotter workspace")).toBeVisible();

  await page.getByRole("button", { name: "CSV Plot" }).click();
  await expect(page.getByText(/last 10s \/ [1-9]\d* point\(s\)/)).toBeVisible();

  await page.getByRole("button", { name: "Clear Plot" }).click();
  await expect(page.getByText("last 10s / 0 point(s)")).toBeVisible();
  await expect(page.getByText("No plot points")).toBeVisible();
});
