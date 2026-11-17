import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('ordinary sous-chef manages refrigerator tasks on the website', async ({ page, browser }) => {
  const origin = 'http://localhost:3103';
  const admin = await browser.newContext();
  await admin.request.post(origin + '/api/login', { headers: { origin }, data: { login: 'admin', password: 'test-password-123' } });
  const create = async (table: string, record: object) => {
    const response = await admin.request.post(origin + '/api/admin', {
      headers: { origin, 'Idempotency-Key': randomUUID() }, data: { operation: 'save', table, record },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data.id;
  };
  const sid = await create('stations', { name: 'Станция холодильников', sort_order: 100 });
  await create('refrigerators', { number: 998, station_id: sid });
  await page.request.post('/api/login', { headers: { origin }, data: { login: 'manager', password: 'test-password-123' } });
  await page.goto('/stations/' + sid);
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Задания холодильника №998', exact: true }) });
  await expect(section).toBeVisible();
  await section.getByRole('button', { name: 'Добавить', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Проверить полки');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(section.getByText('Проверить полки', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Изменить: Проверить полки', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Протереть полки');
  await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(section.getByText('Протереть полки', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/fridge-management.png', fullPage: true });
  await section.getByRole('button', { name: 'Удалить: Протереть полки', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(section.getByText('Задач пока нет.', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
  await admin.close();
});
