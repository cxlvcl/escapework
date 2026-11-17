import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
const dir=mkdtempSync(join(tmpdir(),'escape-admin-browser-')),php=process.env.ESCAPE_PHP_BIN||'php',database=join(dir,'test.db');
const seed=spawnSync(php,['tests/admin-seed.php',database],{encoding:'utf8'});if(seed.status!==0)throw new Error(seed.stdout+seed.stderr);
for(const file of ['mysql.php','mysql-admin.php','admin-security.php'])copyFileSync('hosting/server/'+file,join(dir,file));
writeFileSync(join(dir,'admin.ready'),'1');
const config=`['backend'=>'mysql','origin'=>'http://localhost:3103','google_url'=>'http://127.0.0.1:1','google_secret'=>'${'x'.repeat(32)}','cron_secret'=>'${'y'.repeat(32)}','photo_dir'=>${JSON.stringify(join(dir,'photos'))},'admin_enabled'=>true,'db_dsn'=>${JSON.stringify('sqlite:'+database)},'db_user'=>'','db_password'=>'']`;
writeFileSync(join(dir,'config.php'),'<?php return '+config+';');
// Copy the real gateway and replace only the connection factory with the SQLite dialect adapter.
let gateway=readFileSync('hosting/server/gateway.php','utf8');
gateway=gateway.replace('$mysql ??= new MysqlBackend($config);',`if(!$mysql){$ref=new ReflectionClass(MysqlBackend::class);$mysql=$ref->newInstanceWithoutConstructor();foreach(['db'=>new AdminTestPDO(${JSON.stringify(database)}),'clock'=>null,'config'=>$config] as $key=>$value)$ref->getProperty($key)->setValue($mysql,$value);}`);
writeFileSync(join(dir,'gateway.php'),gateway);
let security=readFileSync(join(dir,'admin-security.php'),'utf8').replace("new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false])",`new AdminTestPDO(${JSON.stringify(database)})`);writeFileSync(join(dir,'admin-security.php'),security);
const publicDir=resolve('hosting/dist/www');
writeFileSync(join(dir,'router.php'),`<?php require ${JSON.stringify(resolve('tests/admin-pdo.php'))}; $path=parse_url($_SERVER['REQUEST_URI'],PHP_URL_PATH);if(str_starts_with($path,'/api/')){require __DIR__.'/gateway.php';return;}if($path==='/admin/'||$path==='/admin'){header('Content-Type: text/html');readfile(${JSON.stringify(publicDir+'/admin/index.html')});return;}if(is_file(${JSON.stringify(publicDir)}.$path))return false;readfile(${JSON.stringify(publicDir+'/index.html')});`);
const server=spawn(php,['-d','upload_max_filesize=3M','-d','post_max_size=13M','-S','localhost:3103','-t',publicDir,join(dir,'router.php')],{env:{...process.env,ESCAPE_PHP_TEST:'1',ESCAPE_PHP_CONFIG:join(dir,'config.php')},stdio:'inherit'});
const stop=()=>{server.kill();setTimeout(()=>{rmSync(dir,{recursive:true,force:true});process.exit(0);},150);};process.on('SIGTERM',stop);process.on('SIGINT',stop);server.on('exit',code=>{if(code)process.exit(code);});
