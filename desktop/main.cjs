const { app, BrowserWindow, Menu, session } = require('electron');
const path = require('node:path');
const offlineURL=require('node:url').pathToFileURL(path.join(__dirname,'offline.html')).href;
const site = 'https://escapeworkspaceru.ru';
let origin=site;
if(!app.isPackaged && process.env.ESCAPE_ADMIN_TEST_ORIGIN){
  const parsed=new URL(process.env.ESCAPE_ADMIN_TEST_ORIGIN);
  if(parsed.protocol!=='http:'||!['localhost','127.0.0.1'].includes(parsed.hostname))throw new Error('Only a loopback test origin is permitted');
  origin=parsed.origin;
}
const allowed=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
let window;
app.enableSandbox();
if(!app.requestSingleInstanceLock()){app.quit();}else{
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
  app.whenReady().then(()=>{
    const ses=session.fromPartition('persist:escape-admin');
    ses.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    ses.setPermissionCheckHandler(()=>false);
    ses.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed(details.url)&&details.url!==offlineURL}));
    ses.on('will-download',event=>event.preventDefault());
    function createWindow(){
      window=new BrowserWindow({width:1380,height:920,minWidth:1000,minHeight:650,title:'ESCAPE Admin',backgroundColor:'#f4f6f5',show:false,webPreferences:{partition:'persist:escape-admin',nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,devTools:!app.isPackaged}});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      window.webContents.on('will-attach-webview',event=>event.preventDefault());
      window.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault();});
      window.webContents.on('will-redirect',(event,url)=>{if(!allowed(url))event.preventDefault();});
      window.webContents.on('did-fail-load',(_event,code,_description,url,isMainFrame)=>{if(isMainFrame&&code!==-3&&allowed(url))window.loadFile(path.join(__dirname,'offline.html'));});
      window.once('ready-to-show',()=>window.show());
      window.on('closed',()=>{window=null;});
      window.loadURL(origin+'/admin/').catch(()=>{});
    }
    const menu=[...(process.platform==='darwin'?[{label:'ESCAPE Admin',submenu:[{role:'about',label:'О приложении'},{type:'separator'},{role:'hide',label:'Скрыть'},{role:'quit',label:'Завершить'}]}]:[]),{label:'Правка',submenu:[{role:'undo',label:'Отменить'},{role:'redo',label:'Повторить'},{type:'separator'},{role:'cut',label:'Вырезать'},{role:'copy',label:'Копировать'},{role:'paste',label:'Вставить'},{role:'selectAll',label:'Выделить всё'}]},{label:'Вид',submenu:[{label:'Переподключиться',accelerator:'CmdOrCtrl+R',click:()=>window?.loadURL(origin+'/admin/').catch(()=>{})},{role:'resetZoom',label:'Исходный масштаб'},{role:'zoomIn',label:'Увеличить'},{role:'zoomOut',label:'Уменьшить'},{role:'togglefullscreen',label:'Полный экран'}]}];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    createWindow();app.on('activate',()=>{if(!window)createWindow();});
  });
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
