<?php
declare(strict_types=1);
// Exercise the real PHP backend with an isolated in-memory SQL database.
// SQLite executes its reads/writes; only MySQL locking/upsert syntax is adapted.
// This does not test InnoDB concurrency or connect to a production database.
final class ApiError extends RuntimeException {
    public function __construct(string $message, public int $status=400, public string $kind='INVALID_INPUT') { parent::__construct($message); }
}
function fail(string $message,int $status=400,string $kind='INVALID_INPUT'): never { throw new ApiError($message,$status,$kind); }
function uuid(): string { $h=bin2hex(random_bytes(16));return substr($h,0,8).'-'.substr($h,8,4).'-4'.substr($h,13,3).'-8'.substr($h,17,3).'-'.substr($h,20); }
function check(bool $condition,string $message): void { if(!$condition)throw new RuntimeException($message); }
function rejected(Closure $call,int $status): void { try{$call();}catch(ApiError $e){check($e->status===$status,'Unexpected error status');return;}throw new RuntimeException('Expected rejection'); }
final class TestStatement extends PDOStatement {
    private SQLite3Result $result;
    public function __construct(private SQLite3Stmt $statement) {}
    public function execute(?array $params=null): bool {
        foreach($params??[] as $i=>$value)$this->statement->bindValue($i+1,$value,$value===null?SQLITE3_NULL:(is_int($value)||is_bool($value)?SQLITE3_INTEGER:SQLITE3_TEXT));
        try{$this->result=$this->statement->execute();}catch(Throwable $e){throw new PDOException($e->getMessage());}
        return true;
    }
    public function fetch(int $mode=PDO::FETCH_DEFAULT,int $cursorOrientation=PDO::FETCH_ORI_NEXT,int $cursorOffset=0): mixed { return $this->result->fetchArray(SQLITE3_ASSOC); }
    public function fetchColumn(int $column=0): mixed { $row=$this->result->fetchArray(SQLITE3_NUM);return $row===false?false:$row[$column]; }
    public function fetchAll(int $mode=PDO::FETCH_DEFAULT,mixed ...$args): array { $rows=[];while($row=$this->fetch())$rows[]=$row;return $rows; }
}
final class TestPDO extends PDO {
    private SQLite3 $sqlite;
    private bool $transaction=false;
    public function __construct() { $this->sqlite=new SQLite3(':memory:');$this->sqlite->enableExceptions(true);$this->sqlite->exec('PRAGMA foreign_keys=ON'); }
    public function prepare(string $query,array $options=[]): PDOStatement|false {
        $query=str_replace(' FOR UPDATE','',$query);
        $conflict=str_contains($query,'INSERT INTO admin_objects')?'table_name,record_id':(str_contains($query,'INSERT INTO admin_members')?'user_id':'id');
        $query=str_replace('ON DUPLICATE KEY UPDATE',"ON CONFLICT($conflict) DO UPDATE SET",$query);
        $query=preg_replace('/VALUES\((\w+)\)/','excluded.$1',$query);
        return new TestStatement($this->sqlite->prepare($query));
    }
    public function query(string $query,?int $fetchMode=null,mixed ...$fetchModeArgs): PDOStatement|false { $statement=$this->prepare($query);$statement->execute();return $statement; }
    public function exec(string $statement): int|false { $this->sqlite->exec($statement);return $this->sqlite->changes(); }
    public function beginTransaction(): bool { $this->sqlite->exec('BEGIN');$this->transaction=true;return true; }
    public function commit(): bool { $this->sqlite->exec('COMMIT');$this->transaction=false;return true; }
    public function rollBack(): bool { $this->sqlite->exec('ROLLBACK');$this->transaction=false;return true; }
    public function inTransaction(): bool { return $this->transaction; }
}
require __DIR__.'/../hosting/server/mysql.php';
$input=json_decode(file_get_contents($argv[1]),true,512,JSON_THROW_ON_ERROR);
$db=new TestPDO();
$schema=file_get_contents(__DIR__.'/../hosting/server/mysql-schema.sql');
$schema=preg_replace('/--[^\n]*/','',$schema);
$schema=preg_replace('/SET NAMES[^;]+;/','',$schema);
$schema=preg_replace('/\) ENGINE=[^;]+;/',');',$schema);
$schema=str_replace([' CHARACTER SET ascii COLLATE ascii_bin',' CHARACTER SET ascii',' UNSIGNED'],'',$schema);
$schema=preg_replace('/ENUM\([^)]+\)/','TEXT',$schema);
$schema=preg_replace('/UNIQUE KEY \w+\(([^)]+)\)/','UNIQUE($1)',$schema);
$schema=preg_replace('/,\s*KEY \w+\([^)]+\)/','',$schema);
$db->exec($schema);
foreach($input['tables'] as $table=>$rows)foreach($rows as $i=>$row){
    if($table==='stations')$row['sort_order']=$i;
    $columns=implode(',',array_map(fn($name)=>'`'.$name.'`',array_keys($row)));
    $placeholders=implode(',',array_fill(0,count($row),'?'));
    $db->prepare("INSERT INTO $table ($columns) VALUES ($placeholders)")->execute(array_values($row));
}
$ref=new ReflectionClass(MysqlBackend::class);
$backend=$ref->newInstanceWithoutConstructor();
$time=new DateTimeImmutable('2026-09-06T15:00:00Z');
$clock=static function()use(&$time):DateTimeImmutable{return $time;};
foreach(['db'=>$db,'clock'=>$clock,'config'=>['google_secret'=>str_repeat('x',32),'photo_dir'=>$input['photoDir']]]as $name=>$value)$ref->getProperty($name)->setValue($backend,$value);
$call=fn(string $action,array $data=[],string $token='manager')=>$backend->execute($action,$data,$token,uuid());
$setTime=static function(string $value)use(&$time){$time=new DateTimeImmutable($value);};
$scalar=fn(string $sql)=>$db->query($sql)->fetchColumn();
foreach(['UTC','America/Los_Angeles','Asia/Tokyo']as $zone){
    date_default_timezone_set($zone);
    foreach(['2026-09-06T21:00:00Z'=>'2026-09-06','2026-09-07T00:59:59.999Z'=>'2026-09-06','2026-09-07T01:00:00Z'=>'2026-09-07','2027-01-01T00:59:59Z'=>'2026-12-31','2027-01-01T01:00:00Z'=>'2027-01-01']as $at=>$expected)
        check($ref->getMethod('date')->invoke($backend,new DateTimeImmutable($at))===$expected,'Work date depends on server timezone or rolls over too early');
}
echo "PHP work-date boundaries and timezones passed\n";
$stationId=$input['tables']['stations'][0]['id'];
$body=['category'=>'station','id'=>$input['tables']['station_tasks'][0]['id'],'mimeType'=>'image/webp','photoBase64'=>$input['photoBase64']];
$call('shift',['action'=>'open','stationId'=>$stationId],'cook');
$call('assignAdditional',['typeId'=>$input['tables']['additional_task_types'][0]['id'],'userIds'=>[$input['tables']['users'][1]['id']]]);
$additionalId=$scalar('SELECT id FROM additional_tasks');
$call('complete',$body,'cook');
$photoId=$scalar('SELECT id FROM station_task_completions');
$setTime('2026-09-06T21:00:00Z');
rejected(fn()=>$call('complete',$body,'cook'),409);
check($call('getKitchen',[],'cook')['date']==='2026-09-06','Midnight reset kitchen');
check(isset($call('getPhoto',['category'=>'station','id'=>$photoId],'cook')['base64']),'Night photo unavailable');
$call('complete',array_replace($body,['category'=>'refrigerator','id'=>$input['tables']['refrigerator_tasks'][0]['id']]),'cook');
$setTime('2026-09-07T00:59:59.999Z');
$call('complete',array_replace($body,['category'=>'additional','id'=>$additionalId]),'cook');
check($call('getAdditional',[],'cook')['tasks'][0]['completedAt']!==null,'Night additional task disappeared');
check($call('getStatistics',['period'=>'today'])['summary']['completed']===3,'Night completions assigned to the wrong date');
$call('snapshot');
check((int)$scalar('SELECT COUNT(*) FROM daily_statistics')===0,'Active work day frozen before 04:00');
$setTime('2026-09-07T01:00:00Z');
$kitchen=$call('getKitchen',[],'cook');
check($kitchen['date']==='2026-09-07','04:00 did not start new work date');
foreach(array_merge($kitchen['tasks'],$kitchen['fridges'])as $task)check($task['completedAt']===null,'Task did not reset at 04:00');
check($kitchen['user']['activeStationId']===$stationId,'Shift was closed at rollover');
check(count($call('getAdditional',[],'cook')['tasks'])===0,'Old additional task still active after 04:00');
rejected(fn()=>$call('getPhoto',['category'=>'station','id'=>$photoId],'cook'),403);
rejected(fn()=>$call('getStatistics',['period'=>'yesterday'],'cook'),403);
rejected(fn()=>$call('getStatistics',['period'=>'invalid']),400);
check((int)$scalar('SELECT COUNT(*) FROM daily_statistics')===0,'Unauthorized read wrote statistics');
$db->exec("CREATE TRIGGER reject_snapshot BEFORE INSERT ON daily_statistics BEGIN SELECT RAISE(ABORT,'test rollback'); END");
try{$call('getStatistics',['period'=>'yesterday']);throw new RuntimeException('Expected failed save');}catch(PDOException){}
check((int)$scalar('SELECT COUNT(*) FROM daily_station_statistics')===0,'Failed recovery left partial station snapshots');
$db->exec('DROP TRIGGER reject_snapshot');
$yesterday=$call('getStatistics',['period'=>'yesterday']);
check(!$yesterday['pending']&&count($yesterday['days'])===1,'Yesterday report missing after cron was skipped');
check($yesterday['days'][0]['finalized']&&$yesterday['days'][0]['date']==='2026-09-06','Wrong closed date');
check($yesterday['summary']['completed']===3&&$yesterday['summary']['total']===128,'Incorrect overall historical result');
$station=$call('getStatistics',['period'=>'yesterday','stationId'=>$stationId]);
check($station['summary']['completed']===2&&$station['summary']['total']===14,'Station filter includes additional tasks or loses completions');
check((int)$scalar('SELECT COUNT(*) FROM daily_station_statistics')===9,'Station snapshots missing');
$call('complete',$body,'cook');
check($call('getStatistics',['period'=>'today'])['summary']['completed']===1,'New day completion failed');
$call('snapshot');
check($call('getStatistics',['period'=>'yesterday'])===$yesterday,'Repeated snapshot changed frozen totals');
echo "PHP night tasks, 04:00 reset, photos, snapshot recovery and rollback passed\n";
$setTime('2026-09-09T01:00:00Z');
$week=$call('getStatistics',['period'=>'week']);
check(array_column($week['days'],'date')===['2026-09-09','2026-09-08','2026-09-07','2026-09-06'],'Missed days not recovered or pre-launch dates invented');
check($week['summary']['completed']===4&&$week['summary']['total']===509,'Incorrect weighted weekly summary');
check(count($call('getStatistics',['period'=>'month'])['days'])===4,'Month report duplicates days');
$db->exec("INSERT INTO daily_statistics VALUES ('2026-08-07',0,1),('2026-08-08',0,1)");
$call('snapshot');
check((int)$scalar("SELECT COUNT(*) FROM daily_statistics WHERE work_date='2026-08-07'")===0,'Old history not cleaned');
check((int)$scalar("SELECT COUNT(*) FROM daily_statistics WHERE work_date='2026-08-08'")===1,'32-day boundary deleted');
echo "PHP missed-day recovery, immutable totals, filters and retention passed\n";
// Monday before 04:00 still belongs to the preceding activity week.
$insert=$db->prepare('INSERT INTO station_task_completions (id,task_id,work_date,photo_path,completed_at,completed_by_user_id) VALUES (?,?,?,?,?,?)');
$author=$input['tables']['users'][1]['id'];
for($i=1;$i<=9;$i++)$insert->execute([uuid(),$input['tables']['station_tasks'][$i]['id'],'2026-09-13','unused','2026-09-14T00:59:59.999Z',$author]);
$insert->execute([uuid(),$input['tables']['station_tasks'][10]['id'],'2026-09-06','unused','2026-09-07T00:59:59.999Z',$author]);
$insert->execute([uuid(),$input['tables']['station_tasks'][11]['id'],'2026-09-14','unused','2026-09-14T01:00:00.000Z',$author]);
$setTime('2026-09-14T00:59:59.999Z');
$activity=$call('getActivity');
check($activity['start']==='2026-09-07'&&$activity['users'][0]['level']==='low','Activity crossed week too early or counted adjacent weeks');
$insert->execute([uuid(),$input['tables']['station_tasks'][12]['id'],'2026-09-13','unused','2026-09-13T23:00:00.000Z',$author]);
check($call('getActivity')['users'][0]['level']==='medium','Late-night completion excluded from its working week');
$setTime('2026-09-14T01:00:00.000Z');
$activity=$call('getActivity');
check($activity['start']==='2026-09-14'&&$activity['users'][0]['level']==='low','Activity week did not reset at 04:00');
echo "PHP activity week also rolls over at 04:00 Moscow\n";

// Migration-day regression: old midnight-based rows survive an ordinary snapshot.
require __DIR__.'/../hosting/server/repair-workday.php';
$db = new TestPDO();
$db->exec($schema);
foreach ($input['tables'] as $table => $rows) foreach ($rows as $i => $row) {
    if ($table === 'stations') $row['sort_order'] = $i;
    $columns = implode(',', array_map(fn($name) => '`'.$name.'`', array_keys($row)));
    $placeholders = implode(',', array_fill(0, count($row), '?'));
    $db->prepare("INSERT INTO $table ($columns) VALUES ($placeholders)")->execute(array_values($row));
}
$ref->getProperty('db')->setValue($backend, $db);
$scalar = fn(string $sql) => $db->query($sql)->fetchColumn();
$setTime('2026-09-13T06:35:00.000Z');
$insert = $db->prepare('INSERT INTO station_task_completions (id,task_id,work_date,photo_path,completed_at,completed_by_user_id) VALUES (?,?,?,?,?,?)');
$nightIds = [];
$photoFile = uuid().'.webp';
file_put_contents($input['photoDir'].'/'.$photoFile, base64_decode($input['photoBase64']));
$photoHash = hash_file('sha256', $input['photoDir'].'/'.$photoFile);
foreach ([
    ['2026-09-13', '2026-09-12T23:35:00.000Z'], // 02:35 MSK, the reported bug.
    ['2026-09-13', '2026-09-13T01:00:00.000Z'], // Exactly 04:00 stays today.
    ['2026-09-13', '2026-09-12T21:00:00.000Z'], // Exactly midnight moves.
    ['2026-09-13', '2026-09-13T00:59:59.999Z'], // Last millisecond before 04:00 moves.
    ['2026-09-12', '2026-09-12T23:50:00.000Z'], // Already correct, must remain unchanged.
    ['2026-09-13', '2026-09-12T20:59:59.999Z'], // Outside the selected interval, not guessed.
] as $i => [$workDate, $completedAt]) {
    $id = uuid();
    $nightIds[$i] = $id;
    $insert->execute([$id, $input['tables']['station_tasks'][$i]['id'], $workDate, 'local:'.$photoFile, $completedAt, $author]);
}
$db->prepare('UPDATE station_tasks SET created_work_date=? WHERE id=?')->execute(['2026-09-13', $input['tables']['station_tasks'][0]['id']]);
$fridgeCompletion = uuid();
$db->prepare('INSERT INTO refrigerator_task_completions (id,task_id,work_date,photo_path,completed_at,completed_by_user_id) VALUES (?,?,?,?,?,?)')->execute([$fridgeCompletion, $input['tables']['refrigerator_tasks'][0]['id'], '2026-09-13', 'local:'.$photoFile, '2026-09-12T23:35:00.000Z', $author]);
$additionalId = uuid();
$db->prepare('INSERT INTO additional_tasks (id,task_type_id,work_date,photo_path,completed_at,completed_by_user_id,title_snapshot) VALUES (?,?,?,?,?,?,?)')->execute([$additionalId, $input['tables']['additional_task_types'][0]['id'], '2026-09-13', 'local:'.$photoFile, '2026-09-12T23:35:00.000Z', $author, 'Night extra']);
$db->prepare('INSERT INTO additional_task_assignees VALUES (?,?)')->execute([$additionalId, $author]);
$pendingExtra = uuid();
$db->prepare('INSERT INTO additional_tasks (id,task_type_id,work_date) VALUES (?,?,?)')->execute([$pendingExtra, $input['tables']['additional_task_types'][0]['id'], '2026-09-13']);
$db->exec("INSERT INTO daily_statistics VALUES ('2026-09-11',77,100),('2026-09-13',5,127)");
$db->prepare('INSERT INTO daily_station_statistics VALUES (?,?,?,?)')->execute(['2026-09-11', $stationId, 77, 100]);
$call('shift', ['action' => 'open', 'stationId' => $stationId], 'cook');
$call('snapshot');
check($scalar("SELECT work_date FROM station_task_completions WHERE id='$nightIds[0]'") === '2026-09-13', 'Fixture failed to reproduce legacy row after normal snapshot');
$beforeRepair = [];
foreach (['station_task_completions', 'refrigerator_task_completions', 'additional_tasks', 'station_tasks', 'daily_statistics', 'daily_station_statistics'] as $table) $beforeRepair[$table] = $db->query("SELECT * FROM $table")->fetchAll();
$repair = new WorkdayRepair($db, dirname($input['photoDir']));
$report = $repair->run('2026-09-13', false, $time);
check($report['completions'] === ['station' => 3, 'refrigerator' => 1, 'additional' => 1], 'Repair misses night categories or includes 04:00/daytime/already-correct rows');
check($report['canApply'] && $report['taskStartDates'] === 1, 'Repair failed to identify a task created during the old calendar night');
foreach ($beforeRepair as $table => $rows) check($db->query("SELECT * FROM $table")->fetchAll() === $rows, 'Preview changed '.$table);
check($repair->backupPath === null, 'Preview wrote a backup');
foreach (['2026-02-30', '2026-09-14', '2026-08-01'] as $date) {
    try { $repair->run($date, true, $time); throw new RuntimeException('Expected invalid repair date rejection'); } catch (WorkdayRepairError) {}
}
// Duplicate task/day must stop the entire transfer, preserving both photo references.
$conflictingId = uuid();
$insert->execute([$conflictingId, $input['tables']['station_tasks'][0]['id'], '2026-09-12', 'older-photo', '2026-09-12T10:00:00.000Z', $author]);
check(!$repair->run('2026-09-13', false, $time)['canApply'], 'Duplicate task/day not reported');
try { $repair->run('2026-09-13', true, $time); throw new RuntimeException('Expected duplicate rejection'); } catch (WorkdayRepairError) {}
check($scalar("SELECT work_date FROM station_task_completions WHERE id='$nightIds[0]'") === '2026-09-13', 'Conflict moved a row');
check($scalar("SELECT photo_path FROM station_task_completions WHERE id='$conflictingId'") === 'older-photo', 'Conflict removed a prior photo');
$db->prepare('DELETE FROM station_task_completions WHERE id=?')->execute([$conflictingId]);
$unwritable = new WorkdayRepair($db, $input['photoDir'].'/missing');
try { $unwritable->run('2026-09-13', true, $time); throw new RuntimeException('Expected backup failure'); } catch (WorkdayRepairError) {}
foreach ($beforeRepair as $table => $rows) check($db->query("SELECT * FROM $table")->fetchAll() === $rows, 'Backup failure changed '.$table);
// A failure while replacing frozen totals rolls back date moves and old snapshots together.
$db->exec("CREATE TRIGGER reject_repair BEFORE INSERT ON daily_statistics BEGIN SELECT RAISE(ABORT,'repair rollback'); END");
try { $repair->run('2026-09-13', true, $time); throw new RuntimeException('Expected repair save failure'); } catch (PDOException) {}
foreach ($beforeRepair as $table => $rows) check($db->query("SELECT * FROM $table")->fetchAll() === $rows, 'Repair rollback failed for '.$table);
$db->exec('DROP TRIGGER reject_repair');
$report = $repair->run('2026-09-13', true, $time);
check($report['changed'] && $report['recalculatedDates'] === ['2026-09-12'], 'Repair froze the active date or failed to replace yesterday');
check($scalar("SELECT work_date FROM station_task_completions WHERE id='$nightIds[0]'") === '2026-09-12', '02:35 MSK completion still belongs to today');
check((int)$scalar("SELECT COUNT(*) FROM daily_statistics WHERE work_date='2026-09-13'") === 0, 'Repair left a frozen active date');
check($scalar("SELECT created_work_date FROM station_tasks WHERE id='".$input['tables']['station_tasks'][0]['id']."'") === '2026-09-12', 'Night task excluded from yesterday denominator');
$afterKitchen = $call('getKitchen', [], 'cook');
check($afterKitchen['tasks'][0]['completedAt'] === null, 'Repaired night task did not reset in the actual kitchen view');
check($call('getPhoto', ['category' => 'station', 'id' => $nightIds[0]])['base64'] === $input['photoBase64'], 'Repaired photo is unavailable to manager');
check(hash_file('sha256', $input['photoDir'].'/'.$photoFile) === $photoHash, 'Repair altered the photo file');
check((int)$scalar("SELECT COUNT(*) FROM additional_task_assignees WHERE additional_task_id='$additionalId'") === 1, 'Repair lost additional assignee');
check($scalar("SELECT work_date FROM additional_tasks WHERE id='$pendingExtra'") === '2026-09-13', 'Repair guessed a date for an uncompleted additional task');
check($call('getStatistics', ['period' => 'yesterday'])['summary']['completed'] === 6, 'Repaired yesterday report lost night completions');
check($call('getStatistics', ['period' => 'today'])['summary']['completed'] === 2, 'Repair moved daytime/out-of-interval completions');
$canonical = $ref->getMethod('counts')->invoke($backend, '2026-09-12');
$yesterday = $call('getStatistics', ['period' => 'yesterday']);
check($yesterday['summary'] === $canonical['overall'], 'Repair summary differs from runtime count rules');
foreach ($canonical['stations'] as $station) {
    $actual = $call('getStatistics', ['period' => 'yesterday', 'stationId' => $station['id']])['summary'];
    unset($station['id']);
    check($actual === $station, 'Repair station filter differs from runtime counts');
}
check((int)$scalar("SELECT completed_tasks FROM daily_statistics WHERE work_date='2026-09-11'") === 77, 'Repair rewrote unrelated frozen totals');
$backup = json_decode(file_get_contents($report['backup']), true, 512, JSON_THROW_ON_ERROR);
check($backup['completionsBefore']['station'][0]['work_date'] === '2026-09-13', 'Backup lacks original work dates');
check(count($backup['stationTasksBefore']) === 1 && count($backup['statisticsBefore']['daily_statistics']) === 2, 'Backup is missing changed task or snapshots');
check((fileperms($report['backup']) & 0777) === 0600, 'Repair backup permissions are not private');
check(!$repair->run('2026-09-13', true, $time)['changed'], 'Repeat transfer changed data');
$call('snapshot');
check($call('getStatistics', ['period' => 'yesterday']) === $yesterday, 'Cron reverted repaired statistics');
// Delayed repair also recalculates the source date when it has since closed.
$laterId = uuid();
$insert->execute([$laterId, $input['tables']['station_tasks'][7]['id'], '2026-09-13', 'local:'.$photoFile, '2026-09-12T23:35:00.000Z', $author]);
$setTime('2026-09-14T01:00:00.000Z');
$call('snapshot');
check($repair->run('2026-09-13', true, $time)['recalculatedDates'] === ['2026-09-12', '2026-09-13'], 'Delayed repair did not update both closed dates');
check((int)$scalar("SELECT completed_tasks FROM daily_statistics WHERE work_date='2026-09-13'") === 2, 'Delayed source snapshot includes moved night record');
echo "PHP legacy-night repair: preview, all categories, conflicts, backups, rollback, 02:35 reset and repeatability passed\n";
require __DIR__.'/mysql-photos.php';
require __DIR__.'/mysql-photo-archive.php';

require __DIR__.'/mysql-admin.php';
