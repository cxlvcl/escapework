<?php
declare(strict_types=1);

/** MySQL/MariaDB backend. Identifiers are internal constants; values use PDO parameters. */
require_once __DIR__.'/mysql-admin.php';
final class MysqlBackend {
    use MysqlAdmin;
    private PDO $db;
    private array $createdPhotos = [];
    private const ROLES = ['cook'=>'Повар','sous_chef'=>'Су-шеф','chef'=>'Шеф-повар','audit'=>'Аудит'];
    public function __construct(private array $config, private ?Closure $clock = null) {
        $this->db = new PDO($config['db_dsn'], $config['db_user'], $config['db_password'], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES=>false, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC, PDO::ATTR_STRINGIFY_FETCHES=>false]);
        $this->db->exec("SET time_zone = '+00:00'");
    }
    private function q(string $sql, array $args=[]): PDOStatement { $q=$this->db->prepare($sql); $q->execute($args); return $q; }
    private function rows(string $sql,array $args=[]): array { return $this->q($sql,$args)->fetchAll(); }
    private function one(string $sql,array $args=[]): ?array { return $this->q($sql,$args)->fetch() ?: null; }
    private function instant(): DateTimeImmutable { return $this->clock ? ($this->clock)() : new DateTimeImmutable('now',new DateTimeZone('UTC')); }
    private function now(?DateTimeImmutable $at=null): string { return ($at??$this->instant())->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z'); }
    private function date(?DateTimeImmutable $at=null): string { return ($at??$this->instant())->setTimezone(new DateTimeZone('Europe/Moscow'))->modify('-4 hours')->format('Y-m-d'); }
    private function offset(string $date,int $days): string { return (new DateTimeImmutable($date))->modify("$days days")->format('Y-m-d'); }
    private function passwordAlgorithm(): string { return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT; }
    private function validateWebp(string $bytes): void {
        $length=strlen($bytes);if($length<30||$length>3*1024*1024||substr($bytes,0,4)!=='RIFF'||substr($bytes,8,4)!=='WEBP')fail('Некорректная фотография WebP.');
        $riff=unpack('Vlength',substr($bytes,4,4));if(!is_array($riff)||($riff['length']??-1)+8!==$length)fail('Некорректная фотография WebP.');
        $width=0;$height=0;
        for($offset=12;$offset+8<=$length;){
            $tag=substr($bytes,$offset,4);$sizeData=unpack('Vlength',substr($bytes,$offset+4,4));$size=(int)($sizeData['length']??-1);$start=$offset+8;
            if($size<0||$start+$size>$length||$tag==='ANIM'||$tag==='ANMF')fail('Некорректная фотография WebP.');
            if($tag==='VP8 '&&$size>=10&&substr($bytes,$start+3,3)==="\x9d\x01\x2a"){$width=(ord($bytes[$start+6])|(ord($bytes[$start+7])<<8))&16383;$height=(ord($bytes[$start+8])|(ord($bytes[$start+9])<<8))&16383;}
            elseif($tag==='VP8L'&&$size>=5&&ord($bytes[$start])===47){$bitsData=unpack('Vbits',substr($bytes,$start+1,4));$bits=(int)($bitsData['bits']??0);$width=($bits&16383)+1;$height=(($bits>>14)&16383)+1;}
            $offset=$start+$size+($size%2);
        }
        if($width<1||$height<1||$width>1600||$height>1600)fail('Некорректная фотография WebP.');
    }
    private function photoPaths(?string $value): array {
        if (!$value) return [];
        if (!str_starts_with($value, '[')) return [$value];
        $paths = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($paths) || !array_is_list($paths) || count($paths) < 1 || count($paths) > 4) throw new RuntimeException('Invalid stored photo references');
        foreach ($paths as $path) if (!is_string($path) || $path === '') throw new RuntimeException('Invalid stored photo reference');
        return $paths;
    }
    private function withPhotoCount(array $tasks): array {
        foreach ($tasks as &$task) {
            $task['photoCount'] = count($this->photoPaths($task['photo_path']));
            unset($task['photo_path']);
        }
        return $tasks;
    }
    private function text(mixed $v,int $max=300): string { if(!is_string($v)||!preg_match('//u',$v)||!trim($v)||preg_match_all('/./us',trim($v))>$max) fail('Проверьте заполненные поля.'); return trim($v); }
    private function id(mixed $v): string { $v=$this->text($v,80); if(!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iD',$v)) fail('Некорректный идентификатор.'); return $v; }
    private function user(?string $token): array {
        if(!$token) fail('Войдите в систему.',401,'UNAUTHORIZED');
        $u=$this->one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL',[hash('sha256',$token),$this->now()]);
        if(!$u || !isset(self::ROLES[$u['role']])) fail('Сессия истекла. Войдите снова.',401,'UNAUTHORIZED'); return $u;
    }
    private function permit(array $u,string $permission): void {
        $ok=match($permission){'manage'=>$u['role']==='sous_chef','monitor'=>in_array($u['role'],['sous_chef','chef','audit'],true),default=>$u['role']==='cook'};
        if(!$ok) fail('Недостаточно прав.',403,'FORBIDDEN');
    }
    private function view(array $u): array { return ['id'=>$u['id'],'name'=>$u['name'],'login'=>$u['login'],'role'=>$u['role'],'activeStationId'=>$u['active_station_id']]; }
    private function progress(int $completed,int $total): array { return ['completed'=>$completed,'total'=>$total,'remaining'=>max(0,$total-$completed),'percent'=>$total?(int)round($completed/$total*100):0]; }
    private function roles(): array { $r=[]; foreach(self::ROLES as $id=>$name)$r[]=['id'=>$id,'name'=>$name]; return $r; }
    private function stations(bool $all=false): array { return $this->rows('SELECT id,name FROM stations WHERE '.($all?'1=1':$this->adminActiveSql('stations','stations.id',$this->date())).' ORDER BY sort_order,id'); }
    private function counts(string $date): array {
        if($this->adminEnabled())return $this->adminCounts($date);
        $stations=$this->rows('SELECT s.id, (SELECT COUNT(*) FROM station_tasks t WHERE t.station_id=s.id AND t.created_work_date<=? AND (t.inactive_work_date IS NULL OR t.inactive_work_date>?)) + (SELECT COUNT(*) FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id WHERE r.station_id=s.id) AS total, (SELECT COUNT(*) FROM station_tasks t JOIN station_task_completions c ON c.task_id=t.id AND c.work_date=? WHERE t.station_id=s.id AND t.created_work_date<=? AND (t.inactive_work_date IS NULL OR t.inactive_work_date>?)) + (SELECT COUNT(*) FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id JOIN refrigerator_task_completions c ON c.task_id=t.id AND c.work_date=? WHERE r.station_id=s.id) AS completed FROM stations s ORDER BY s.sort_order,s.id',[$date,$date,$date,$date,$date,$date]);
        $total=0;$done=0; foreach($stations as &$s){$total+=(int)$s['total'];$done+=(int)$s['completed'];$s=['id'=>$s['id']]+$this->progress((int)$s['completed'],(int)$s['total']);}unset($s);
        $extra=$this->one('SELECT COUNT(*) total,COUNT(completed_at) completed FROM additional_tasks WHERE work_date=?',[$date]);
        return ['stations'=>$stations,'overall'=>$this->progress($done+(int)$extra['completed'],$total+(int)$extra['total'])];
    }
    public function execute(string $action,array $d=[],?string $token=null,?string $requestId=null): mixed {
        $this->closeExpiredCookShifts();
        $this->createdPhotos = [];
        $commitAttempted = false;
        $write=in_array($action,['login','logout','shift','task','createUser','updateUser','deleteUser','assignAdditional','additionalType','complete','snapshot','adminWrite'],true);
        // Short transactions serialize mutations, preserving last-manager and task ordering invariants.
        // Statistics can recover missed daily snapshots, so it also takes the mutex.
        $this->db->beginTransaction();
        try {
            if($write||$action==='getStatistics') $this->q('SELECT id FROM app_mutex WHERE id=1 FOR UPDATE')->fetch();
            $key=null;$fingerprint=null;
            if($write&&!in_array($action,['login','logout','snapshot'],true)){
                $actor=$this->user($token);if($action==='adminWrite')$this->requireAdmin($actor);$this->id($requestId);$key=hash('sha256',$token.':'.$requestId);
                $fd=$d;unset($fd['passwordHash'],$fd['credentialFingerprint']);
                if(isset($fd['record']['password'])){$fd['record']['passwordFingerprint']=hash_hmac('sha256',(string)$fd['record']['password'],$this->config['google_secret']);unset($fd['record']['password']);}
                if(isset($fd['password'])){$fd['credentialFingerprint']=hash_hmac('sha256',$fd['password'],$this->config['google_secret']);unset($fd['password']);}
                $fingerprint=hash('sha256',json_encode(['action'=>$action,'data'=>$fd],JSON_THROW_ON_ERROR));
                $old=$this->one('SELECT fingerprint,response FROM operations WHERE id=? AND expires_at>?',[$key,$this->now()]);
                if($old){if(!hash_equals($old['fingerprint'],$fingerprint))fail('Ключ запроса уже использован.',409,'IDEMPOTENCY_CONFLICT');$this->db->commit();return json_decode($old['response'],true,512,JSON_THROW_ON_ERROR);}
            }
            $answer=$this->dispatch($action,$d,$token);
            if($key)$this->q('INSERT INTO operations (id,fingerprint,response,expires_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE fingerprint=VALUES(fingerprint),response=VALUES(response),expires_at=VALUES(expires_at)',[$key,$fingerprint,json_encode($answer,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR),gmdate('Y-m-d\TH:i:s',time()+86400).'.000Z']);
            $commitAttempted = true;
            $this->db->commit();return $answer;
        } catch(Throwable $e) {
            if($this->db->inTransaction()){
                if($action==='login'&&$e instanceof ApiError&&in_array($e->kind,['BAD_LOGIN','RATE_LIMIT'],true))$this->db->commit();else $this->db->rollBack();
            }
            // Keep files if COMMIT may have reached the database; retries reuse the same completion.
            if (!$commitAttempted) foreach ($this->createdPhotos as $path) @unlink($path);
            if($action==='adminWrite'&&$e instanceof PDOException&&str_starts_with((string)$e->getCode(),'23'))fail('Проверьте уникальность полей и связанные записи. Изменения не сохранены.',409);
            throw $e;
        }
    }
    private function dispatch(string $action,array $d,?string $token): mixed {
        $at=$this->instant();$date=$this->date($at);$now=$this->now($at);
        if($action==='login'){
            $login=$this->text($d['login']??null,80);$password=validPassword($d['password']??null,1);$key=hash('sha256','login:'.$login);
            $attempt=$this->one('SELECT * FROM login_attempts WHERE `key`=?',[$key]);
            $n=($attempt&&$attempt['reset_at']>$now)?(int)$attempt['attempts']+1:1;
            $reset=($attempt&&$attempt['reset_at']>$now)?$attempt['reset_at']:gmdate('Y-m-d\TH:i:s',time()+900).'.000Z';
            $this->q('INSERT INTO login_attempts (`key`,attempts,reset_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE attempts=VALUES(attempts),reset_at=VALUES(reset_at)',[$key,$n,$reset]);
            if($n>10)fail('Слишком много попыток. Повторите через 15 минут.',429,'RATE_LIMIT');
            $u=$this->one('SELECT * FROM users WHERE login=? AND deleted_at IS NULL',[$login]);
            $hash=$u['password_hash']??'$2y$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.';
            $legacy=str_starts_with($hash,'scrypt:');
            $valid=$legacy?(google('bridgeVerify',['password'=>$password,'encoded'=>$hash])['valid']??false):password_verify($password,$hash);
            if(!$u||!$valid)fail('Неверный логин или пароль.',401,'BAD_LOGIN');
            $algorithm=$this->passwordAlgorithm();
            if($legacy||password_needs_rehash($hash,$algorithm))$this->q('UPDATE users SET password_hash=? WHERE id=?',[password_hash($password,$algorithm),$u['id']]);
            $session=$d['sessionToken']??'';if(!is_string($session)||!preg_match('/^[A-Za-z0-9_-]{43}$/D',$session))fail('Некорректная сессия.');
            $expires=gmdate('Y-m-d\TH:i:s',time()+604800).'.000Z';
            $this->q('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)',[hash('sha256',$session),$u['id'],$expires]);
            $this->q('DELETE FROM login_attempts WHERE `key`=?',[$key]);return ['user'=>$this->view($u),'expiresAt'=>$expires];
        }
        if($action==='logout'){$this->q('DELETE FROM sessions WHERE token_hash=?',[hash('sha256',$token??'')]);return ['ok'=>true];}
        if($action==='snapshot')return $this->snapshot($date);
        $u=$this->user($token);
        if($action==='adminRead')return $this->adminRead($u,$d);
        if($action==='adminWrite')return $this->adminWrite($u,$d);
        switch($action){
            case 'getCurrentUser': return $this->view($u);
            case 'getRoles':$this->permit($u,'manage');return $this->roles();
            case 'getUsers':$this->permit($u,'manage');return ['users'=>array_map($this->view(...),$this->rows('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name,id')),'roles'=>$this->roles()];
            case 'getKitchen':
                $args=[$date];$where='';if($u['role']==='cook'){$where=' AND t.station_id=?';$args[]=$u['active_station_id'];}
                $tasks=$this->rows("SELECT t.id,t.title,t.station_id stationId,t.task_type taskType,t.sort_order sortOrder,'station' category,c.completed_at completedAt,c.id photoId,c.photo_path FROM station_tasks t LEFT JOIN station_task_completions c ON c.task_id=t.id AND c.work_date=? WHERE t.is_active=1 AND {$this->adminActiveSql('stations','t.station_id',$date)}$where ORDER BY t.sort_order,t.id",$args);
                $args=[$date];$where=' WHERE '.$this->adminActiveSql('stations','r.station_id',$date).' AND '.$this->adminActiveSql('refrigerators','r.id',$date).' AND '.$this->adminActiveSql('refrigerator_tasks','t.id',$date);if($u['role']==='cook'){$where.=' AND r.station_id=?';$args[]=$u['active_station_id'];}
                $fridges=$this->rows("SELECT t.id,t.title,'refrigerator' category,r.station_id stationId,r.id refrigeratorId,r.number refrigeratorNumber,c.completed_at completedAt,c.id photoId,c.photo_path FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id LEFT JOIN refrigerator_task_completions c ON c.task_id=t.id AND c.work_date=?$where ORDER BY r.number,t.sort_order,t.id",$args);
                return ['managedRefrigerators'=>$u['role']==='sous_chef'&&$this->adminEnabled()?$this->rows('SELECT r.id,r.number,r.station_id stationId FROM refrigerators r WHERE '.$this->adminActiveSql('refrigerators','r.id',$date).' AND '.$this->adminActiveSql('stations','r.station_id',$date).' ORDER BY r.number'):[], 'user'=>$this->view($u),'date'=>$date,'stations'=>$this->stations(),'tasks'=>$this->withPhotoCount($tasks),'fridges'=>$this->withPhotoCount($fridges),'stats'=>$u['role']==='cook'?null:$this->counts($date)];
            case 'getAdditional':
                $args=[$date];$where='';if($u['role']==='cook'){$where=' AND EXISTS (SELECT 1 FROM additional_task_assignees a WHERE a.additional_task_id=t.id AND a.user_id=?)';$args[]=$u['id'];}
                $tasks=$this->rows("SELECT t.id,COALESCE(t.title_snapshot,y.title) title,'additional' category,t.completed_at completedAt,CASE WHEN t.completed_at IS NOT NULL THEN t.id ELSE NULL END photoId,t.photo_path FROM additional_tasks t JOIN additional_task_types y ON y.id=t.task_type_id WHERE t.work_date=?$where ORDER BY t.id",$args);
                if($u['role']!=='cook')foreach($tasks as &$t)$t['assignees']=array_column($this->rows('SELECT u.name FROM additional_task_assignees a JOIN users u ON u.id=a.user_id WHERE a.additional_task_id=? ORDER BY u.name',[$t['id']]),'name');unset($t);
                $types=$u['role']==='sous_chef'?$this->rows('SELECT * FROM additional_task_types ORDER BY id'):[];foreach($types as &$t)$t['is_active']=(bool)$t['is_active'];unset($t);
                return ['tasks'=>$this->withPhotoCount($tasks),'types'=>$types,'cooks'=>$u['role']==='sous_chef'?$this->rows("SELECT id,name FROM users WHERE role='cook' AND deleted_at IS NULL ORDER BY name"):[]];
            case 'getActivity':
                $this->permit($u,'monitor');$start=$this->offset($date,1-(int)(new DateTimeImmutable($date))->format('N'));$end=$this->offset($start,7);
                $from=gmdate('Y-m-d\TH:i:s',strtotime($start.'T04:00:00+03:00')).'.000Z';$until=gmdate('Y-m-d\TH:i:s',strtotime($end.'T04:00:00+03:00')).'.000Z';
                $users=$this->rows("SELECT u.id,u.name,u.role, (SELECT COUNT(*) FROM station_task_completions c WHERE c.completed_by_user_id=u.id AND c.completed_at>=? AND c.completed_at<?)+(SELECT COUNT(*) FROM refrigerator_task_completions c WHERE c.completed_by_user_id=u.id AND c.completed_at>=? AND c.completed_at<?)+(SELECT COUNT(*) FROM additional_tasks c WHERE c.completed_by_user_id=u.id AND c.completed_at>=? AND c.completed_at<?) n FROM users u WHERE u.role='cook' AND u.deleted_at IS NULL ORDER BY u.name,u.id",[$from,$until,$from,$until,$from,$until]);
                $summary=['low'=>0,'medium'=>0,'high'=>0];foreach($users as &$r){$r['level']=$r['n']<=10?'low':($r['n']<=17?'medium':'high');$summary[$r['level']]++;unset($r['n']);}unset($r);return compact('start','end','summary','users');
            case 'getStatistics':return $this->statistics($u,$d,$date);
            case 'getPhotos':return $this->photos($u,$d,$date);
            case 'getPhoto':return $this->photo($u,$d,$date);
            case 'shift':
                $this->permit($u,'complete');
                if(($d['action']??'')==='close')$sid=null;
                elseif(($d['action']??'')==='open'){if($u['active_station_id'])fail('Сначала закройте текущую смену.',409);$sid=$this->id($d['stationId']??null);if(!$this->one('SELECT id FROM stations WHERE id=? AND '.$this->adminActiveSql('stations','stations.id',$date),[$sid]))fail('Станция не найдена.',404);}
                else fail('Некорректное действие.');
                $this->recordShift($u,$sid,$now);
                $this->q('UPDATE users SET active_station_id=? WHERE id=?',[$sid,$u['id']]);break;
            case 'createUser':case 'updateUser':case 'deleteUser':return $this->editUser($u,$action,$d,$now);
            case 'task':return $this->editTask($u,$d,$date);
            case 'additionalType':
                $this->permit($u,'manage');$title=$this->text($d['title']??null);if(!is_bool($d['isActive']??null))fail('Укажите активность типа.');$id=isset($d['id'])?$this->id($d['id']):uuid();
                if($this->one('SELECT id FROM additional_task_types WHERE LOWER(title)=LOWER(?) AND id<>?',[$title,$id]))fail('Тип с таким названием уже существует.',409);
                if(isset($d['id'])){$type=$this->one('SELECT * FROM additional_task_types WHERE id=?',[$id]);if(!$type)fail('Тип не найден.',404);$this->q('UPDATE additional_tasks SET title_snapshot=? WHERE task_type_id=? AND title_snapshot IS NULL',[$type['title'],$id]);$this->q('UPDATE additional_task_types SET title=?,is_active=? WHERE id=?',[$title,(int)$d['isActive'],$id]);}
                else $this->q('INSERT INTO additional_task_types (id,title,is_active) VALUES (?,?,?)',[$id,$title,(int)$d['isActive']]);break;
            case 'assignAdditional':
                $this->permit($u,'manage');$type=$this->one('SELECT * FROM additional_task_types WHERE id=? AND is_active=1',[$this->id($d['typeId']??null)]);if(!$type)fail('Тип задачи не найден.',404);
                if(!is_array($d['userIds']??null)||count($d['userIds'])<1||count($d['userIds'])>200)fail('Выберите поваров.');$ids=array_unique(array_map($this->id(...),$d['userIds']));
                foreach($ids as $id)if(!$this->one("SELECT id FROM users WHERE id=? AND role='cook' AND deleted_at IS NULL",[$id]))fail('Можно назначить задачу только поварам.');
                $id=uuid();$this->q('INSERT INTO additional_tasks (id,task_type_id,title_snapshot,work_date) VALUES (?,?,?,?)',[$id,$type['id'],$type['title'],$date]);foreach($ids as $uid)$this->q('INSERT INTO additional_task_assignees (additional_task_id,user_id) VALUES (?,?)',[$id,$uid]);break;
            case 'complete':return $this->complete($u,$d,$date);
            default:fail('Неизвестное действие API.',404,'NOT_FOUND');
        }
        return ['ok'=>true];
    }
    private function editUser(array $u,string $action,array $d,string $now): array {
        $this->permit($u,'manage');$target=null;
        if($action!=='createUser'){$target=$this->one('SELECT * FROM users WHERE id=?',[$this->id($d['id']??null)]);if(!$target)fail('Аккаунт не найден.',404);if($target['deleted_at']){if($action==='deleteUser')return ['ok'=>true];fail('Аккаунт не найден.',404);}}
        $role=$d['role']??$target['role']??null;if($action!=='deleteUser'&&(!is_string($role)||!isset(self::ROLES[$role])))fail('Выберите доступную роль.');
        if($target&&$target['role']==='sous_chef'&&($action==='deleteUser'||$role!=='sous_chef')&&!$this->one("SELECT id FROM users WHERE role='sous_chef' AND deleted_at IS NULL AND id<>?",[$target['id']]))fail('Нельзя удалить или изменить роль последнего су-шефа.',409);
        if($target && $this->adminMember($target) && !$this->adminMember($u))fail('Аккаунт администратора может редактировать только администратор.',403,'FORBIDDEN');
        if($target && $this->adminMember($target) && ($action==='deleteUser'||$role==='cook'))fail('Сначала отзовите доступ администратора через установщик на сервере.',409);
        if($target && ($action==='deleteUser'||$role!==$target['role']))$this->recordShift($target,null,$now,$action==='deleteUser'?'user_removed':'role_changed');
        if($action==='deleteUser'){$this->q('UPDATE users SET deleted_at=?,active_station_id=NULL WHERE id=?',[$now,$target['id']]);$this->q('DELETE FROM sessions WHERE user_id=?',[$target['id']]);return ['ok'=>true];}
        $login=$this->text($d['login']??null,80);$name=$this->text($d['name']??null,100);$id=$target['id']??uuid();
        if($this->one('SELECT id FROM users WHERE login=? AND deleted_at IS NULL AND id<>?',[$login,$id]))fail('Этот логин уже занят.',409);
        $hash=isset($d['password'])?password_hash(validPassword($d['password']),$this->passwordAlgorithm()):null;
        if(!$target){if(!$hash)fail('Укажите пароль.');$this->q('INSERT INTO users (id,name,login,password_hash,role) VALUES (?,?,?,?,?)',[$id,$name,$login,$hash,$role]);}
        else{$this->q('UPDATE users SET name=?,login=?,role=?,password_hash=?,active_station_id=? WHERE id=?',[$name,$login,$role,$hash??$target['password_hash'],$role!==$target['role']?null:$target['active_station_id'],$id]);if($hash||$role!==$target['role'])$this->q('DELETE FROM sessions WHERE user_id=?',[$id]);}
        return ['ok'=>true];
    }
    private function editTask(array $u,array $d,string $date): array {
        $this->permit($u,'manage');$action=$d['action']??'';
        if(($d['category']??'station')==='refrigerator')return $this->editRefrigeratorTask($d,$date);
        if(($d['category']??'station')!=='station')fail('Некорректная категория.');
        if($action==='create'){
            $sid=$this->id($d['stationId']??null);if(!$this->one('SELECT id FROM stations WHERE id=? AND '.$this->adminActiveSql('stations','stations.id',$date),[$sid]))fail('Станция не найдена.',404);if(!in_array($d['taskType']??null,['main','individual'],true))fail('Некорректный тип задачи.');
            $n=(int)$this->q('SELECT COALESCE(MAX(sort_order),-1)+1 FROM station_tasks WHERE station_id=?',[$sid])->fetchColumn();
            $this->q('INSERT INTO station_tasks (id,station_id,title,task_type,sort_order,is_active,created_work_date) VALUES (?,?,?,?,?,1,?)',[uuid(),$sid,$this->text($d['title']??null),$d['taskType'],$n,$date]);
        }else{
            $t=$this->one('SELECT * FROM station_tasks WHERE id=? AND is_active=1',[$this->id($d['id']??null)]);if(!$t)fail('Задача не найдена.',404);
            if($action==='rename')$this->q('UPDATE station_tasks SET title=? WHERE id=?',[$this->text($d['title']??null),$t['id']]);
            elseif($action==='delete')$this->q('UPDATE station_tasks SET is_active=0,inactive_work_date=? WHERE id=?',[$date,$t['id']]);
            elseif($action==='move'){
                if(!in_array($d['direction']??null,['up','down'],true))fail('Некорректный порядок.');$ids=array_column($this->rows('SELECT id FROM station_tasks WHERE station_id=? AND is_active=1 ORDER BY sort_order,id',[$t['station_id']]),'id');$i=array_search($t['id'],$ids,true);$j=$i+($d['direction']==='up'?-1:1);
                if(isset($ids[$j])){[$ids[$i],$ids[$j]]=[$ids[$j],$ids[$i]];foreach($ids as $n=>$id)$this->q('UPDATE station_tasks SET sort_order=? WHERE id=?',[$n,$id]);}
            }else fail('Некорректное действие.');
        }return ['ok'=>true];
    }
    private function statistics(array $u,array $d,string $date): array {
        $this->permit($u,'monitor');$p=$d['period']??null;if(!in_array($p,['today','yesterday','week','month'],true))fail('Некорректный период.');$sid=empty($d['stationId'])?null:$this->id($d['stationId']);if($sid&&!$this->one('SELECT id FROM stations WHERE id=?',[$sid]))fail('Станция не найдена.',404);
        $this->finalizeClosedStatistics($date);
        $start=$this->offset($date,match($p){'yesterday'=>-1,'week'=>-6,'month'=>-29,default=>0});$end=$p==='yesterday'?$start:$date;
        $closedEnd=min($end,$this->offset($date,-1));
        $rows=$sid?$this->rows('SELECT * FROM daily_station_statistics WHERE station_id=? AND work_date>=? AND work_date<=?',[$sid,$start,$closedEnd]):$this->rows('SELECT * FROM daily_statistics WHERE work_date>=? AND work_date<=?',[$start,$closedEnd]);
        $days=[];foreach($rows as $r)$days[]=['date'=>$r['work_date'],'finalized'=>true]+$this->progress((int)$r['completed_tasks'],(int)$r['total_tasks']);
        if($end===$date){$live=$this->counts($date);$v=$sid?$this->progress(0,0):$live['overall'];if($sid)foreach($live['stations'] as $s)if($s['id']===$sid)$v=$s;$days[]=['date'=>$date,'finalized'=>false]+$v;}
        usort($days,fn($a,$b)=>strcmp($b['date'],$a['date']));return ['days'=>$days,'summary'=>$this->progress(array_sum(array_column($days,'completed')),array_sum(array_column($days,'total'))),'pending'=>$p!=='today'&&!in_array($this->offset($date,-1),array_column($days,'date'),true)];
    }
    private function finalizeClosedStatistics(string $date): void {
        $oldest=$this->offset($date,-32);
        $first=$this->q('SELECT MIN(work_date) FROM (SELECT MIN(created_work_date) work_date FROM station_tasks UNION ALL SELECT MIN(work_date) FROM station_task_completions UNION ALL SELECT MIN(work_date) FROM refrigerator_task_completions UNION ALL SELECT MIN(work_date) FROM additional_tasks) known_dates')->fetchColumn();
        $saved=array_fill_keys(array_column($this->rows('SELECT work_date FROM daily_statistics WHERE work_date>=? AND work_date<?',[$oldest,$date]),'work_date'),true);
        // Reconstruct missing closed days from retained task history; never freeze the active day.
        for($day=max($oldest,$first?:$date);$day<$date;$day=$this->offset($day,1)) {
            if(isset($saved[$day]))continue;
            $p=$this->counts($day);
            foreach($p['stations'] as $s)$this->q('INSERT INTO daily_station_statistics (work_date,station_id,completed_tasks,total_tasks) VALUES (?,?,?,?)',[$day,$s['id'],$s['completed'],$s['total']]);
            $this->q('INSERT INTO daily_statistics (work_date,completed_tasks,total_tasks) VALUES (?,?,?)',[$day,$p['overall']['completed'],$p['overall']['total']]);
        }
        foreach(['daily_statistics','daily_station_statistics'] as $table)$this->q("DELETE FROM $table WHERE work_date<?",[$oldest]);
    }
    private function snapshot(string $date): array {
        $this->finalizeClosedStatistics($date);
        foreach(['sessions'=>'expires_at','operations'=>'expires_at','login_attempts'=>'reset_at'] as $table=>$column)$this->q("DELETE FROM $table WHERE $column<=?",[$this->now()]);
        if($this->adminEnabled())foreach(['admin_security_events'=>'occurred_at','admin_traffic'=>'minute_at'] as $table=>$column)$this->q("DELETE FROM $table WHERE $column<?",[$this->offset($date,-32).'T00:00:00.000Z']);
        return ['ok'=>true,'workDate'=>$this->offset($date,-1)];
    }
    private function task(array $u,string $category,string $id,string $date): void {
        $this->permit($u,'complete');
        if($this->adminEnabled() && $category!=='additional'){
            $sid=$u['active_station_id'];if(!$sid||!$this->one('SELECT id FROM stations WHERE id=? AND '.$this->adminActiveSql('stations','stations.id',$date),[$sid]))fail('Станция недоступна.',403,'FORBIDDEN');
            if($category==='refrigerator'&&!$this->one('SELECT t.id FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id WHERE t.id=? AND '.$this->adminActiveSql('refrigerators','r.id',$date).' AND '.$this->adminActiveSql('refrigerator_tasks','t.id',$date),[$id]))fail('Задание недоступно.',403,'FORBIDDEN');
        }
        if($category==='additional'){$t=$this->one('SELECT t.* FROM additional_tasks t JOIN additional_task_assignees a ON a.additional_task_id=t.id WHERE t.id=? AND a.user_id=?',[$id,$u['id']]);if(!$t)fail('Задача вам не назначена.',403,'FORBIDDEN');if($t['completed_at']||$t['work_date']!==$date)fail('Задача уже выполнена или относится к прошедшему дню.',409,'ALREADY_COMPLETED');return;}
        if($category==='station')$t=$this->one('SELECT station_id FROM station_tasks WHERE id=? AND is_active=1',[$id]);
        elseif($category==='refrigerator')$t=$this->one('SELECT r.station_id FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id WHERE t.id=?',[$id]);else fail('Неизвестная категория задачи.');
        if(!$t||!$u['active_station_id']||$t['station_id']!==$u['active_station_id'])fail('Задача недоступна на вашей станции.',403,'FORBIDDEN');
        $table=$category==='station'?'station_task_completions':'refrigerator_task_completions';if($this->one("SELECT id FROM $table WHERE task_id=? AND work_date=?",[$id,$date]))fail('Эта задача уже выполнена.',409,'ALREADY_COMPLETED');
    }
    private function complete(array $u,array $d,string $date): array {
        $category=$this->text($d['category']??null,30);$id=$this->id($d['id']??null);$this->task($u,$category,$id,$date);
        if (array_key_exists('photosBase64',$d) && array_key_exists('photoBase64',$d)) fail('Передайте один список фотографий.');
        $images = $d['photosBase64'] ?? (isset($d['photoBase64']) ? [$d['photoBase64']] : []);
        if (!is_array($images) || !array_is_list($images) || count($images) < 1 || count($images) > 4) fail('Прикрепите от 1 до 4 фотографий.');
        if (($d['mimeType']??null) !== 'image/webp') fail('Требуется WebP.');
        $decoded = [];
        foreach ($images as $image) {
            if (!is_string($image) || strlen($image) > 4*1024*1024) fail('Некорректная фотография WebP.');
            $bytes = base64_decode($image,true);
            if ($bytes === false) fail('Некорректная фотография WebP.');
            $this->validateWebp($bytes);
            $decoded[] = $bytes;
        }
        $dir=$this->config['photo_dir'];if(!is_dir($dir)&&!mkdir($dir,0700,true))fail('Не удалось создать папку фотографий.',503);
        $paths = [];
        foreach ($decoded as $bytes) {
            $file=uuid().'.webp';$path=$dir.'/'.$file;
            $handle=fopen($path,'xb');if(!$handle)fail('Не удалось сохранить фото.',503);
            $this->createdPhotos[] = $path;
            try {
                if (!chmod($path,0600) || fwrite($handle,$bytes)!==strlen($bytes) || !fflush($handle)) fail('Не удалось сохранить фото.',503);
            } finally { fclose($handle); }
            $paths[] = 'local:'.$file;
        }
        $savedAt=$this->instant();if($this->adminEnabled()&&$this->date($savedAt)!==$date)fail('Рабочий день завершён. Откройте новую смену.',409,'SHIFT_DAY_ENDED');$date=$this->date($savedAt);$this->task($u,$category,$id,$date);$now=$this->now($savedAt);
        // Four local UUID references fit the existing VARCHAR(255), preserving the deployed schema.
        $photo=count($paths)===1?$paths[0]:json_encode($paths,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
        if($category==='additional')$this->q('UPDATE additional_tasks SET photo_path=?,completed_at=?,completed_by_user_id=? WHERE id=?',[$photo,$now,$u['id'],$id]);else{$table=$category==='station'?'station_task_completions':'refrigerator_task_completions';$this->q("INSERT INTO $table (id,task_id,work_date,photo_path,completed_at,completed_by_user_id) VALUES (?,?,?,?,?,?)",[uuid(),$id,$date,$photo,$now,$u['id']]);}return ['ok'=>true];
    }
    private function photos(array $u,array $d,string $today): array {
        $this->permit($u,'monitor');
        $date = array_key_exists('date',$d) ? $d['date'] : $today;
        $oldestDate = $this->offset($today,-32);
        if (!is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D',$date) || $date < $oldestDate || $date > $today)
            fail('Выберите дату за последние 32 рабочих дня или текущий день.');
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d',$date,new DateTimeZone('Europe/Moscow'));
        if (!$parsed || $parsed->format('Y-m-d') !== $date) fail('Некорректная дата.');
        // No is_active filter: historical completions survive task deactivation.
        $tasks = $this->rows("SELECT t.id,t.title,t.station_id stationId,t.task_type taskType,t.sort_order sortOrder,'station' category,c.completed_at completedAt,c.id photoId,c.photo_path FROM station_task_completions c JOIN station_tasks t ON t.id=c.task_id WHERE c.work_date=? AND c.completed_at IS NOT NULL AND c.photo_path IS NOT NULL AND c.photo_path<>'' ORDER BY t.sort_order,t.id",[$date]);
        $fridges = $this->rows("SELECT t.id,t.title,'refrigerator' category,r.station_id stationId,r.id refrigeratorId,r.number refrigeratorNumber,t.sort_order sortOrder,c.completed_at completedAt,c.id photoId,c.photo_path FROM refrigerator_task_completions c JOIN refrigerator_tasks t ON t.id=c.task_id JOIN refrigerators r ON r.id=t.refrigerator_id WHERE c.work_date=? AND c.completed_at IS NOT NULL AND c.photo_path IS NOT NULL AND c.photo_path<>'' ORDER BY r.number,t.sort_order,t.id",[$date]);
        $additional = $this->rows("SELECT t.id,COALESCE(t.title_snapshot,y.title) title,'additional' category,t.completed_at completedAt,t.id photoId,t.photo_path FROM additional_tasks t JOIN additional_task_types y ON y.id=t.task_type_id WHERE t.work_date=? AND t.completed_at IS NOT NULL AND t.photo_path IS NOT NULL AND t.photo_path<>'' ORDER BY t.id",[$date]);
        foreach ($additional as &$task) $task['assignees'] = array_column($this->rows('SELECT u.name FROM additional_task_assignees a JOIN users u ON u.id=a.user_id WHERE a.additional_task_id=? ORDER BY u.name',[$task['id']]),'name');
        unset($task);
        return ['date'=>$date,'today'=>$today,'oldestDate'=>$oldestDate,'stations'=>$this->stations(true),'tasks'=>$this->withPhotoCount(array_merge($tasks,$fridges,$additional))];
    }
    private function photo(array $u,array $d,string $date): array {
        $id=$this->id($d['id']??null);$category=$d['category']??null;
        $sql=match($category){'station'=>'SELECT c.*,t.station_id FROM station_task_completions c JOIN station_tasks t ON t.id=c.task_id WHERE c.id=?','refrigerator'=>'SELECT c.*,r.station_id FROM refrigerator_task_completions c JOIN refrigerator_tasks t ON t.id=c.task_id JOIN refrigerators r ON r.id=t.refrigerator_id WHERE c.id=?','additional'=>'SELECT * FROM additional_tasks WHERE id=?',default=>null};if(!$sql)fail('Неизвестная категория.');$c=$this->one($sql,[$id]);if(!$c||!$c['photo_path'])fail('Фото не найдено.',404);
        if($u['role']==='cook'){
            if($c['work_date']!==$date)fail('Недостаточно прав.',403,'FORBIDDEN');
            if($category==='additional'){if(!$this->one('SELECT user_id FROM additional_task_assignees WHERE additional_task_id=? AND user_id=?',[$id,$u['id']]))fail('Недостаточно прав.',403,'FORBIDDEN');}
            elseif(!$u['active_station_id']||$c['station_id']!==$u['active_station_id'])fail('Недостаточно прав.',403,'FORBIDDEN');
        }
        $paths=$this->photoPaths($c['photo_path']);$index=$d['index']??0;
        if(!is_int($index)||$index<0||!isset($paths[$index]))fail('Фото не найдено.',404,'NOT_FOUND');
        $reference=$paths[$index];
        if(str_starts_with($reference,'local:')){$file=substr($reference,6);if(!preg_match('/^[a-f0-9-]{36}\.webp$/D',$file))fail('Фото не найдено.',404);$bytes=@file_get_contents($this->config['photo_dir'].'/'.$file);if($bytes===false)fail('Фото не найдено.',404);return ['base64'=>base64_encode($bytes),'mimeType'=>'image/webp'];}
        return google('bridgePhoto',['fileId'=>$reference]);
    }
}
