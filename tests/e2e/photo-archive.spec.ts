import { test, expect } from "@playwright/test";
import { dateOffset } from "../../lib/domain";

test("sous-chef calendar opens all historical photos, bounds 32 days, and protects access", async ({
  page,
  browser,
}) => {
  const origin = "http://localhost:3101";
  expect((await page.request.get("/api/photos")).status()).toBe(401);
  const login = async (name: string) => {
    expect(
      (
        await page.request.post("/api/login", {
          headers: { origin },
          data: { login: name, password: "test-password-123" },
        })
      ).status(),
    ).toBe(200);
  };
  await login("sous");
  const response = await page.request.get("/api/photos");
  expect(response.status()).toBe(200);
  const { today, oldestDate } = (await response.json()).data;
  const yesterday = dateOffset(today, -1);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("link", { name: "Фотографии", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Фотографии", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Архивная проверка станции/ }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Архив фотографий", exact: true })
    .click();
  const calendar = page.getByRole("dialog", { name: "Архив фотографий" });
  await expect(calendar).toBeVisible();
  await expect(
    calendar.locator(`button[data-date="${yesterday}"]`),
  ).toBeFocused();
  await expect(
    calendar.getByRole("button", { name: "Следующий месяц" }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/mobile-photo-calendar.png" });
  await calendar.locator(`button[data-date="${yesterday}"]`).click();
  await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));
  await expect(
    page.getByRole("button", { name: /Архивная проверка станции/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Архивная дополнительная задача/ }),
  ).toBeVisible();
  const images = page.locator(".gallery-grid img");
  await expect(images).toHaveCount(7);
  for (const img of await images.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveJSProperty("naturalWidth", 160);
  }
  await page.screenshot({
    path: "test-results/mobile-photo-archive.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /Архивная проверка станции/ }).click();
  const viewer = page.getByRole("dialog", {
    name: "Архивная проверка станции",
  });
  for (let index = 1; index < 4; index++)
    await viewer.getByRole("button", { name: "Следующее фото" }).click();
  await expect(viewer.getByText("Фото 4 из 4", { exact: true })).toBeVisible();
  const fourthPhoto = viewer.getByRole("img", {
    name: "Фото 4: Архивная проверка станции",
    exact: true,
  });
  const privateUrl = (await fourthPhoto.getAttribute("src"))!;
  await expect(fourthPhoto).toHaveJSProperty("naturalWidth", 160);
  await viewer.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page
    .getByRole("button", { name: "Архив фотографий", exact: true })
    .click();
  for (
    let step = 0;
    step < 3 &&
    !(await calendar.locator(`button[data-date="${oldestDate}"]`).isVisible());
    step++
  )
    await calendar.getByRole("button", { name: "Предыдущий месяц" }).click();
  await expect(
    calendar.getByRole("button", { name: "Предыдущий месяц" }),
  ).toBeDisabled();
  await expect(
    calendar.locator(`button[data-date="${oldestDate}"]`),
  ).toBeEnabled();
  await calendar.locator(`button[data-date="${oldestDate}"]`).click();
  await expect(page.locator(".gallery-grid img")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".gallery-grid img")).toHaveCount(1);
  await page.goto(`/photos?date=${dateOffset(oldestDate, 1)}`);
  await expect(
    page.getByText("За этот рабочий день фотографий нет.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Сегодня", exact: true }).click();
  await expect(page).toHaveURL(origin + "/photos");
  for (const date of [
    dateOffset(oldestDate, -1),
    dateOffset(today, 1),
    "invalid",
    "",
  ])
    expect((await page.request.get(`/api/photos?date=${date}`)).status()).toBe(
      400,
    );
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(origin + privateUrl)).status()).toBe(401);
  await anonymous.close();
  for (const role of ["chef", "audit"]) {
    await login(role);
    expect(
      (await page.request.get(`/api/photos?date=${yesterday}`)).status(),
    ).toBe(200);
    expect((await page.request.get(privateUrl)).status()).toBe(200);
  }
  await login("sous");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/photos?date=${yesterday}`);
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: "Фотографии", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/desktop-photo-archive.png",
    fullPage: true,
  });
  await login("cook-a");
  expect(
    (await page.request.get(`/api/photos?date=${yesterday}`)).status(),
  ).toBe(403);
  expect((await page.request.get(privateUrl)).status()).toBe(403);
  await page.goto(`/photos?date=${yesterday}`);
  await expect(page).toHaveURL(origin + "/");
  await expect(
    page.getByRole("link", { name: "Фотографии", exact: true }),
  ).toHaveCount(0);
});
