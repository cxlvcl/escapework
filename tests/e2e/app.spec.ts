import { test, expect, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
const origin = "http://localhost:3101";
const pass = "test-password-123";
async function login(request: APIRequestContext, name: string) {
  const res = await request.post("/api/login", {
    headers: { origin },
    data: { login: name, password: pass },
  });
  expect(res.status()).toBe(200);
}
async function mutation(
  request: APIRequestContext,
  path: string,
  data: unknown,
) {
  return request.post(path, { headers: { origin }, data });
}
test("real server rejects anonymous, chef and cook management; login and logout work", async ({
  request,
}) => {
  expect(
    (await mutation(request, "/api/tasks", { action: "create" })).status(),
  ).toBe(401);
  expect(
    (
      await mutation(request, "/api/login", {
        login: "sous",
        password: "wrong",
      })
    ).status(),
  ).toBe(401);
  await login(request, "chef");
  for (const path of [
    "/api/users",
    "/api/tasks",
    "/api/additional",
    "/api/shift",
    "/api/complete",
  ])
    expect((await mutation(request, path, {})).status()).toBe(403);
  await login(request, "cook-a");
  for (const path of ["/api/users", "/api/tasks", "/api/additional"])
    expect((await mutation(request, path, {})).status()).toBe(403);
  expect(
    (
      await request.post("/api/shift", {
        headers: { origin: "https://evil.example" },
        data: { action: "close" },
      })
    ).status(),
  ).toBe(403);
  await mutation(request, "/api/logout", {});
  expect(
    (await mutation(request, "/api/shift", { action: "close" })).status(),
  ).toBe(401);
});
test("mobile sous-chef dashboard, task management and user creation", async ({
  page,
}) => {
  await page.goto("/login");
  const logo = page.getByRole("img", {
    name: "ESCAPE RESTAURANT",
    exact: true,
  });
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty("naturalWidth", 686);
  await page.screenshot({
    path: "test-results/mobile-login.png",
    fullPage: true,
  });
  await page.getByLabel("Логин", { exact: true }).fill("sous");
  await page.getByLabel("Пароль", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Порядок в каждом цехе" }),
  ).toBeVisible();
  await expect(page.locator(".station-card")).toHaveCount(9);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-dashboard.png",
    fullPage: true,
  });
  await page.locator(".station-card").first().click();
  await page.getByRole("button", { name: "Добавить", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Проверка новой задачи");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Проверка новой задачи Не выполнено/ }),
  ).toBeVisible();
  await page.goto("/users");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Тест Новый повар");
  await page.getByLabel("Логин", { exact: true }).fill("new-cook");
  await page
    .getByRole("combobox", { name: "Роль", exact: true })
    .selectOption("cook");
  await page.getByLabel("Пароль", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Тест Новый повар" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Порядок в каждом цехе" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/desktop-dashboard.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cook shared checklist, mandatory compressed photo, protected photo, close and reopen", async ({
  page,
  browser,
}) => {
  await login(page.request, "cook-a");
  await page.goto("/");
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  const select = page.getByRole("combobox", { name: "Станция", exact: true });
  const stationId = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(stationId!);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Горячий цех Греция", exact: true }),
  ).toBeVisible();
  expect(
    (
      await mutation(page.request, "/api/shift", { action: "open", stationId })
    ).status(),
  ).toBe(409);
  const contextB = await browser.newContext();
  const other = await contextB.newPage();
  await login(contextB.request, "cook-b");
  await mutation(contextB.request, "/api/shift", { action: "open", stationId });
  await other.goto("/");
  const title = "Общая чистота станции/столов.";
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Подтвердить выполнение" }),
  ).toBeDisabled();
  const original = await sharp({
    create: { width: 3200, height: 2400, channels: 3, background: "#aaaaaa" },
  })
    .jpeg()
    .toBuffer();
  await page.locator("input[type=file]:not([capture])").setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: original,
  });
  await expect(
    page.getByRole("button", { name: "Подтвердить выполнение" }),
  ).toBeEnabled();
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/complete"),
  );
  await page.getByRole("button", { name: "Подтвердить выполнение" }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: new RegExp(title) }).first(),
  ).toContainText("Выполнено");
  await expect(
    other.getByRole("button", { name: new RegExp(title) }).first(),
  ).toContainText("Выполнено", { timeout: 20000 });
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  const img = page.getByRole("dialog").locator("img");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src"))!;
  const photo = await page.request.get(src);
  expect(photo.status()).toBe(200);
  const metadata = await sharp(await photo.body()).metadata();
  expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(1600);
  expect(metadata.format).toBe("webp");
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.screenshot({
    path: "test-results/mobile-cook.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть смену", exact: true })
    .click();
  await expect(
    page.getByText("Смена завершена", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(src)).status()).toBe(403);
  await page
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Станция", exact: true })
    .selectOption({ index: 2 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Открыть смену", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Холодный цех Греция", exact: true }),
  ).toBeVisible();
  await contextB.close();
});

test("additional task shared by two cooks, refrigerator photo and chef read-only screens", async ({
  page,
  browser,
}) => {
  await login(page.request, "sous");
  await page.goto("/additional");
  await page
    .getByRole("button", { name: "Назначить задачу", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Задача", exact: true })
    .selectOption({ label: "Тип только для автоматического теста" });
  await page.getByLabel("Тест Повар A", { exact: true }).check();
  await page.getByLabel("Тест Повар B", { exact: true }).check();
  await page.getByRole("button", { name: "Назначить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Тип только для автоматического теста/ }),
  ).toBeVisible();
  const context = await browser.newContext();
  const cook = await context.newPage();
  await login(context.request, "cook-a");
  await cook.goto("/additional");
  await cook
    .getByRole("button", { name: /Тип только для автоматического теста/ })
    .click();
  const buffer = await sharp({
    create: { width: 2000, height: 1500, channels: 3, background: "#888888" },
  })
    .jpeg()
    .toBuffer();
  await cook
    .locator("input[type=file]:not([capture])")
    .setInputFiles({ name: "task.jpg", mimeType: "image/jpeg", buffer });
  await expect(
    cook.getByRole("button", { name: "Подтвердить выполнение" }),
  ).toBeEnabled();
  const done = cook.waitForResponse((r) => r.url().endsWith("/api/complete"));
  await cook.getByRole("button", { name: "Подтвердить выполнение" }).click();
  expect((await done).status()).toBe(200);
  await cook
    .getByRole("button", { name: /Тип только для автоматического теста/ })
    .click();
  const taskId = (await cook
    .getByRole("dialog")
    .locator("img")
    .getAttribute("src"))!
    .split("/")
    .at(-1)!;
  await cook.getByRole("button", { name: "Закрыть", exact: true }).click();
  await login(context.request, "cook-b");
  await cook.reload();
  await expect(
    cook.getByRole("button", { name: /Тип только для автоматического теста/ }),
  ).toContainText("Выполнено");
  const compressed = await sharp(buffer)
    .resize(1600)
    .webp({ quality: 70 })
    .toBuffer();
  const duplicate = await context.request.post("/api/complete", {
    headers: { origin },
    multipart: {
      category: "additional",
      id: taskId,
      photo: { name: "photo.webp", mimeType: "image/webp", buffer: compressed },
    },
  });
  expect(duplicate.status()).toBe(409);
  await cook.goto("/");
  await cook.locator("summary").first().click();
  await cook
    .getByRole("button", { name: /Наличие актуальных маркировок/ })
    .first()
    .click();
  await cook
    .locator("input[type=file]:not([capture])")
    .setInputFiles({ name: "fridge.jpg", mimeType: "image/jpeg", buffer });
  await expect(
    cook.getByRole("button", { name: "Подтвердить выполнение" }),
  ).toBeEnabled();
  const fridgeDone = cook.waitForResponse((r) =>
    r.url().endsWith("/api/complete"),
  );
  await cook.getByRole("button", { name: "Подтвердить выполнение" }).click();
  expect((await fridgeDone).status()).toBe(200);
  await login(page.request, "chef");
  for (const path of [
    "/",
    "/stations",
    "/completed",
    "/additional",
    "/photos",
    "/statistics?period=week",
  ]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    await expect(
      page.getByText("Не удалось загрузить страницу", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await context.close();
});

test("role picker creates audit, chef and sous-chef with actual server permissions", async ({
  page,
  browser,
}) => {
  await login(page.request, "sous");
  await page.goto("/users");
  for (const [role, label] of [
    ["chef", "Шеф-повар"],
    ["audit", "Аудит"],
    ["sous_chef", "Су-шеф"],
  ] as const) {
    await page.getByRole("button", { name: "Создать аккаунт" }).click();
    const picker = page.getByRole("combobox", { name: "Роль", exact: true });
    await expect(picker.locator("option")).toHaveCount(5);
    await picker.selectOption(role);
    await page.getByLabel("Имя", { exact: true }).fill("Новый " + label);
    await page.getByLabel("Логин", { exact: true }).fill("created-" + role);
    await page.getByLabel("Пароль", { exact: true }).fill(pass);
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Новый " + label, exact: true }),
    ).toBeVisible();
    const context = await browser.newContext();
    await login(context.request, "created-" + role);
    const result = await mutation(context.request, "/api/users", {
      name: "Проверка",
      login: "child-" + role,
      role: "cook",
      password: pass,
    });
    expect(result.status()).toBe(role === "sous_chef" ? 200 : 403);
    const view = await context.newPage();
    await view.goto("/");
    await expect(
      view.getByRole("heading", { name: "Порядок в каждом цехе" }),
    ).toBeVisible();
    await context.close();
  }
});

test("catalog management, account role editing and activity access on mobile", async ({
  page,
  browser,
}) => {
  await login(page.request, "sous");
  await page.goto("/additional?tab=types");
  await expect(
    page.getByRole("heading", { name: "Уборка лёдогенератора", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Добавить тип", exact: true }).click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Проверка справочника");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Проверка справочника", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Изменить тип: Проверка справочника",
      exact: true,
    })
    .click();
  await page.getByLabel("Название", { exact: true }).fill("Проверка изменена");
  await page.getByLabel("Доступен для назначения", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Проверка изменена", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Назначить задачу", exact: true })
    .click();
  await expect(
    page
      .getByRole("combobox", { name: "Задача", exact: true })
      .locator("option"),
  ).toHaveCount(11);
  await expect(
    page
      .getByRole("combobox", { name: "Задача", exact: true })
      .locator("option", { hasText: "Проверка изменена" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.goto("/users");
  await page
    .getByRole("button", { name: "Создать аккаунт", exact: true })
    .click();
  await page.getByLabel("Имя", { exact: true }).fill("Аудит после изменения");
  await page.getByLabel("Логин", { exact: true }).fill("edit-to-audit");
  await page.getByLabel("Пароль", { exact: true }).fill(pass);
  await page
    .getByRole("combobox", { name: "Роль", exact: true })
    .selectOption("cook");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const card = page.locator(".card").filter({
    has: page.getByRole("heading", {
      name: "Аудит после изменения",
      exact: true,
    }),
  });
  await card.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Роль", exact: true })
    .selectOption("audit");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(card).toContainText("Аудит");
  await page.goto("/statistics");
  await page
    .getByRole("link", { name: "Статистика активности →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Статистика активности", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-activity.png",
    fullPage: true,
  });
  for (const account of ["chef", "edit-to-audit", "cook-a"]) {
    const context = await browser.newContext();
    await login(context.request, account);
    expect((await context.request.get("/api/activity")).status()).toBe(
      account === "cook-a" ? 403 : 200,
    );
    expect(
      (
        await mutation(context.request, "/api/additional-types", {
          title: "Denied",
          isActive: true,
        })
      ).status(),
    ).toBe(403);
    const view = await context.newPage();
    await view.goto("/activity");
    if (account === "cook-a")
      await expect(view).toHaveURL("http://localhost:3101/");
    else
      await expect(
        view.getByRole("heading", {
          name: "Статистика активности",
          exact: true,
        }),
      ).toBeVisible();
    await context.close();
  }
});

test("sous-chef deletes an account with confirmation and invalidates its session", async ({
  page,
  browser,
}) => {
  await login(page.request, "sous");
  expect(
    (
      await mutation(page.request, "/api/users", {
        name: "Удаляемый повар",
        login: "delete-me",
        role: "cook",
        password: pass,
      })
    ).status(),
  ).toBe(200);
  const context = await browser.newContext();
  await login(context.request, "delete-me");
  await page.goto("/users");
  await page
    .getByRole("button", {
      name: "Удалить аккаунт: Удаляемый повар",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Выполненные задачи и фотографии сохранятся",
  );
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Удаляемый повар", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Удалить аккаунт: Удаляемый повар",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Удалить аккаунт", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Удаляемый повар", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await mutation(context.request, "/api/shift", { action: "close" })
    ).status(),
  ).toBe(401);
  await context.close();
});

test("one to four photos: selection, deletion, gallery and server validation", async ({
  page,
  browser,
}) => {
  await login(page.request, "sous");
  await page.goto("/");
  const firstStation = page.locator(".station-card").first();
  await expect(firstStation).toBeVisible();
  const stationId = (await firstStation.getAttribute("href"))!
    .split("/")
    .at(-1)!;
  const title = "Несколько фотографий " + crypto.randomUUID();
  expect(
    (
      await mutation(page.request, "/api/tasks", {
        action: "create",
        stationId,
        title,
        taskType: "main",
      })
    ).status(),
  ).toBe(200);
  await login(page.request, "cook-a");
  await mutation(page.request, "/api/shift", { action: "close" });
  await mutation(page.request, "/api/shift", { action: "open", stationId });
  // Malformed uploads must fail before task lookup or file storage.
  const id = crypto.randomUUID();
  const files = await Promise.all(
    ["red", "blue", "green", "yellow"].map(async (background, index) => ({
      name: `photo-${index}.jpg`,
      mimeType: "image/jpeg",
      buffer: await sharp({
        create: { width: 1800, height: 1200, channels: 3, background },
      })
        .jpeg()
        .toBuffer(),
    })),
  );
  const compressed = await sharp(files[0].buffer)
    .resize(1200)
    .webp()
    .toBuffer();
  const form = (count: number, invalid = false) => {
    const body = new FormData();
    body.set("category", "station");
    body.set("id", id);
    for (let i = 0; i < count; i++)
      body.append(
        "photos[]",
        new Blob(
          [
            new Uint8Array(
              invalid && i === count - 1
                ? Buffer.from("invalid image")
                : compressed,
            ),
          ],
          { type: "image/webp" },
        ),
        `photo-${i}.webp`,
      );
    return body;
  };
  for (const body of [form(0), form(5), form(2, true)])
    expect(
      (
        await page.request.post("/api/complete", {
          headers: { origin },
          multipart: body,
        })
      ).status(),
    ).toBe(400);
  const mixed = form(1);
  mixed.append(
    "photo",
    new Blob([new Uint8Array(compressed)], { type: "image/webp" }),
    "legacy.webp",
  );
  expect(
    (
      await page.request.post("/api/complete", {
        headers: { origin },
        multipart: mixed,
      })
    ).status(),
  ).toBe(400);
  await page.goto("/");
  const card = page.getByRole("button", { name: new RegExp(title) }).first();
  await card.click();
  const dialog = page.getByRole("dialog");
  const picker = dialog.locator("input[type=file]:not([capture])");
  const confirm = dialog.getByRole("button", {
    name: "Подтвердить выполнение",
  });
  await expect(confirm).toBeDisabled();
  await picker.setInputFiles([...files, files[0]]);
  await expect(dialog.getByText(/Можно прикрепить максимум 4/)).toBeVisible();
  await expect(confirm).toBeDisabled();
  await picker.setInputFiles(files.slice(0, 2));
  await expect(
    dialog.getByText("Фотографии: 2 из 4", { exact: true }),
  ).toBeVisible();
  await expect(confirm).toBeEnabled();
  await picker.setInputFiles(files.slice(2));
  await expect(
    dialog.getByText("Фотографии: 4 из 4", { exact: true }),
  ).toBeVisible();
  await expect(picker).toBeDisabled();
  await expect(dialog.locator("input[capture]")).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Удалить фото 2", exact: true })
    .click();
  await expect(
    dialog.getByText("Фотографии: 3 из 4", { exact: true }),
  ).toBeVisible();
  await expect(picker).toBeEnabled();
  await picker.setInputFiles(files[1]);
  await expect(
    dialog.getByText("Фотографии: 4 из 4", { exact: true }),
  ).toBeVisible();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: "test-results/mobile-four-photo-picker.png" });
  const uploaded = page.waitForResponse((response) =>
    response.url().endsWith("/api/complete"),
  );
  await confirm.click();
  expect((await uploaded).status()).toBe(200);
  await expect(card).toContainText("Фото: 4");
  await card.click();
  const photoUrls: string[] = [];
  for (let i = 0; i < 4; i++) {
    await expect(
      dialog.getByText(`Фото ${i + 1} из 4`, { exact: true }),
    ).toBeVisible();
    const img = dialog.locator("img");
    await expect(img).toHaveJSProperty("complete", true);
    await expect(img).toHaveJSProperty("naturalWidth", 1600);
    const src = (await img.getAttribute("src"))!;
    photoUrls.push(src);
    expect((await page.request.get(src)).status()).toBe(200);
    if (i < 3)
      await dialog.getByRole("button", { name: "Следующее фото" }).click();
  }
  await expect(
    dialog.getByRole("button", { name: "Следующее фото" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Предыдущее фото" }).click();
  await expect(dialog.getByText("Фото 3 из 4", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/mobile-four-photo-viewer.png" });
  const anonymous = await browser.newContext();
  expect((await anonymous.request.get(origin + photoUrls[3])).status()).toBe(
    401,
  );
  await anonymous.close();
  await mutation(page.request, "/api/shift", { action: "close" });
  expect((await page.request.get(photoUrls[3])).status()).toBe(403);
  await login(page.request, "chef");
  for (const src of photoUrls)
    expect((await page.request.get(src)).status()).toBe(200);
  await page.goto("/photos");
  for (const src of photoUrls)
    await expect(page.locator(`a[href="${src}"] img`)).toBeVisible();
});
