import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/admin',workers:1,timeout:60000,use:{baseURL:'http://localhost:3103',viewport:{width:1440,height:1000}},webServer:{command:'node tests/admin-environment.mjs',url:'http://localhost:3103/admin/',reuseExistingServer:false,timeout:30000},reporter:'list'});
