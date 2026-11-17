import {test,expect,_electron as electron} from '@playwright/test';
import sharp from 'sharp';
import path from 'node:path';

test('administrator manages site data, photos, shifts and sees security events',async({page,browser})=>{
 const origin='http://localhost:3103';
 expect((await page.request.get('/api/admin')).status()).toBe(401);
 await page.goto('/admin/');
 await page.getByLabel('Логин',{exact:true}).fill('manager');await page.getByLabel('Пароль',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByText('Доступ администратора не назначен этому аккаунту.')).toBeVisible();
 await page.getByLabel('Логин',{exact:true}).fill('admin');await page.getByLabel('Пароль',{exact:true}).fill('test-password-123');await page.getByRole('button',{name:'Войти',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Обзор',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Станции',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
 const modal=page.locator('#modal');await modal.getByLabel('Название',{exact:true}).fill('Новая станция <script>');await modal.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(page.getByRole('cell',{name:'Новая станция <script>',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Все задания',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(modal.getByLabel('Станция',{exact:true})).toBeVisible();await modal.getByLabel('Станция',{exact:true}).selectOption({label:(await modal.getByLabel('Станция',{exact:true}).locator('option').allTextContents()).find(t=>t.includes('Новая станция'))!});
 await modal.getByLabel('Задание',{exact:true}).fill('Проверка новой станции');await modal.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('cell',{name:'Проверка новой станции',exact:true})).toBeVisible();
 const cook=await browser.newContext();
 expect((await cook.request.post(origin+'/api/login',{headers:{origin},data:{login:'cook',password:'test-password-123'}})).status()).toBe(200);
 const kitchen=(await (await cook.request.get(origin+'/api/read?view=kitchen')).json()).data;
 expect((await cook.request.post(origin+'/api/shift',{headers:{origin},data:{action:'open',stationId:kitchen.stations[0].id}})).status()).toBe(200);
 await page.getByRole('button',{name:'База фотографий',exact:true}).click();await page.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(modal.getByLabel('Задание',{exact:true})).toBeVisible();await modal.getByLabel('Задание',{exact:true}).selectOption({label:(await modal.getByLabel('Задание',{exact:true}).locator('option').allTextContents()).find(t=>t.includes('Проверка новой станции'))!});
 const photo=await sharp({create:{width:60,height:40,channels:3,background:'#426652'}}).webp().toBuffer();
 await modal.locator('input[type=file]').setInputFiles([{name:'1.webp',mimeType:'image/webp',buffer:photo},{name:'2.webp',mimeType:'image/webp',buffer:photo}]);
 await modal.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('button',{name:'Фото · 2',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Фото · 2',exact:true}).click();await expect(modal.locator('img')).toHaveCount(2);for(const img of await modal.locator('img').all())await expect(img).toHaveJSProperty('naturalWidth',60);await modal.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Смены',exact:true}).click();await expect(page.getByRole('cell',{name:'cook',exact:true})).toBeVisible();
 await page.screenshot({path:'test-results/admin-shifts.png',fullPage:true});
 await page.getByRole('button',{name:'Закрыть смену',exact:true}).click();await modal.getByRole('button',{name:'Закрыть смену',exact:true}).click();await expect(page.getByRole('cell',{name:'cook',exact:true})).toHaveCount(0);
 expect((await (await cook.request.get(origin+'/api/read?view=user')).json()).data.activeStationId).toBeNull();
 const bad=await browser.newContext();expect((await bad.request.post(origin+'/api/login',{headers:{origin},data:{login:'manager',password:'wrong-password'}})).status()).toBe(401);
 await page.getByRole('button',{name:'Безопасность',exact:true}).click();await expect(page.getByRole('cell',{name:'Неверный логин или пароль',exact:true})).toBeVisible();await page.screenshot({path:'test-results/admin-security.png',fullPage:true});
 await page.getByRole('button',{name:'Журнал изменений',exact:true}).click();await expect(page.getByRole('cell',{name:'Создание',exact:true}).first()).toBeVisible();
 expect((await cook.request.get(origin+'/api/admin')).status()).toBe(403);
 await cook.close();await bad.close();
});

test('native application isolates the remote admin page from Node and navigation',async()=>{
 const app=await electron.launch({executablePath:path.resolve('desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),args:[path.resolve('desktop/main.cjs')],env:{...process.env,ELECTRON_RUN_AS_NODE:'',ESCAPE_ADMIN_TEST_ORIGIN:'http://localhost:3103'}});
 try{const window=await app.firstWindow();await window.waitForURL('http://localhost:3103/admin/');await expect(window.getByRole('heading',{name:'Администрирование'})).toBeVisible();
 expect(await window.evaluate(()=>typeof (window as unknown as {require:unknown}).require)).toBe('undefined');
 const preferences=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
 expect(preferences.nodeIntegration).toBe(false);expect(preferences.contextIsolation).toBe(true);expect(preferences.sandbox).toBe(true);
 await window.evaluate(()=>globalThis.open('https://example.com/'));expect(app.windows()).toHaveLength(1);
 await window.screenshot({path:'test-results/admin-native.png'});
 }finally{await app.close();}
});
