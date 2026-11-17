<?php
declare(strict_types=1);
trait MysqlAdmin {
    private function editRefrigeratorTask(array $d,string $date): array {
        if(!$this->adminEnabled())fail('Сначала включите обновление админ-панели.',503);
        $action=$d['action']??'';$task=null;
        if($action==='create')$rid=$this->id($d['refrigeratorId']??null);
        else {
            $task=$this->one('SELECT * FROM refrigerator_tasks WHERE id=? AND '.$this->adminActiveSql('refrigerator_tasks','refrigerator_tasks.id',$date),[$this->id($d['id']??null)]);
            if(!$task)fail('Задача не найдена.',404);$rid=$task['refrigerator_id'];
        }
        if(!$this->one('SELECT r.id FROM refrigerators r WHERE r.id=? AND '.$this->adminActiveSql('refrigerators','r.id',$date).' AND '.$this->adminActiveSql('stations','r.station_id',$date),[$rid]))fail('Холодильник не найден.',404);
        if($action==='create'){
            $id=uuid();$order=(int)$this->q('SELECT COALESCE(MAX(sort_order),-1)+1 FROM refrigerator_tasks WHERE refrigerator_id=?',[$rid])->fetchColumn();
            $this->q('INSERT INTO refrigerator_tasks (id,refrigerator_id,title,sort_order) VALUES (?,?,?,?)',[$id,$rid,$this->text($d['title']??null),$order]);
            $this->q('INSERT INTO admin_objects (table_name,record_id,created_work_date) VALUES (?,?,?)',['refrigerator_tasks',$id,$date]);
        }elseif($action==='rename')$this->q('UPDATE refrigerator_tasks SET title=? WHERE id=?',[$this->text($d['title']??null),$task['id']]);
        elseif($action==='delete')$this->q('INSERT INTO admin_objects (table_name,record_id,deleted_work_date) VALUES (?,?,?) ON DUPLICATE KEY UPDATE deleted_work_date=VALUES(deleted_work_date)',['refrigerator_tasks',$task['id'],$date]);
        elseif($action==='move'){
            if(!in_array($d['direction']??null,['up','down'],true))fail('Некорректный порядок.');
            $ids=array_column($this->rows('SELECT id FROM refrigerator_tasks WHERE refrigerator_id=? AND '.$this->adminActiveSql('refrigerator_tasks','refrigerator_tasks.id',$date).' ORDER BY sort_order,id',[$rid]),'id');
            $i=array_search($task['id'],$ids,true);$j=$i+($d['direction']==='up'?-1:1);
            if(isset($ids[$j])){[$ids[$i],$ids[$j]]=[$ids[$j],$ids[$i]];foreach($ids as $n=>$id)$this->q('UPDATE refrigerator_tasks SET sort_order=? WHERE id=?',[$n,$id]);}
        }else fail('Некорректное действие.');
        return ['ok'=>true];
    }
    private function closeExpiredCookShifts(): void {
        if(!$this->adminEnabled())return;
        $boundary=$this->now(new DateTimeImmutable($this->date().'T04:00:00+03:00'));
        $sql="SELECT s.* FROM admin_shifts s JOIN users u ON u.id=s.user_id WHERE u.role='cook' AND s.closed_at IS NULL AND s.observed_at<?";
        if(!$this->one($sql,[$boundary]))return;
        // Commit maintenance independently: a rejected cook request must not reopen yesterday's shift.
        $this->db->beginTransaction();
        try {
            $this->q('SELECT id FROM app_mutex WHERE id=1 FOR UPDATE')->fetch();
            foreach($this->rows($sql,[$boundary]) as $shift){
                $day=$this->date(new DateTimeImmutable($shift['observed_at']));
                $closed=$this->now(new DateTimeImmutable($this->offset($day,1).'T04:00:00+03:00'));
                $this->q('UPDATE admin_shifts SET closed_at=?,close_reason=? WHERE id=? AND closed_at IS NULL',[$closed,'workday_end',$shift['id']]);
                if(!$this->one('SELECT id FROM admin_shifts WHERE user_id=? AND closed_at IS NULL',[$shift['user_id']]))
                    $this->q("UPDATE users SET active_station_id=NULL WHERE id=? AND role='cook'",[$shift['user_id']]);
            }
            $this->db->commit();
        } catch(Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
    }
    private function adminEnabled(): bool { return (bool)($this->config['admin_enabled']??is_file(__DIR__.'/admin.ready')); }
    private function adminMember(array $u): bool { return $this->adminEnabled() && $u['role']!=='cook' && (bool)$this->one('SELECT user_id FROM admin_members WHERE user_id=?',[$u['id']]); }
    private function requireAdmin(array $u): void { if(!$this->adminMember($u))fail('Доступ администратора не назначен этому аккаунту.',403,'FORBIDDEN'); }
    private function adminActiveSql(string $table,string $id,string $date): string {
        if(!$this->adminEnabled())return '1=1';
        // All three arguments are code-owned identifiers or an internal YYYY-MM-DD date.
        return "NOT EXISTS (SELECT 1 FROM admin_objects ao WHERE ao.table_name='$table' AND ao.record_id=$id AND (ao.created_work_date>'$date' OR ao.deleted_work_date<='$date'))";
    }
    private function recordShift(array $u,?string $station,string $now,string $reason='manual'): void {
        if(!$this->adminEnabled())return;
        $this->q('UPDATE admin_shifts SET closed_at=?,close_reason=? WHERE user_id=? AND closed_at IS NULL',[$now,$reason,$u['id']]);
        if($station!==null){$s=$this->one('SELECT name FROM stations WHERE id=?',[$station]);$this->q('INSERT INTO admin_shifts (id,user_id,station_id,user_name,station_name,opened_at,observed_at) VALUES (?,?,?,?,?,?,?)',[uuid(),$u['id'],$station,$u['name'],$s['name'],$now,$now]);}
    }
    private function adminCounts(string $date): array {
        $stations=$this->rows('SELECT id FROM stations WHERE '.$this->adminActiveSql('stations','stations.id',$date).' ORDER BY sort_order,id');
        $tasks=$this->rows('SELECT id,station_id FROM station_tasks WHERE created_work_date<=? AND (inactive_work_date IS NULL OR inactive_work_date>?)',[$date,$date]);
        $fridges=$this->rows('SELECT t.id,r.station_id FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id WHERE '.$this->adminActiveSql('refrigerators','r.id',$date).' AND '.$this->adminActiveSql('refrigerator_tasks','t.id',$date));
        $doneS=array_fill_keys(array_column($this->rows('SELECT task_id FROM station_task_completions WHERE work_date=?',[$date]),'task_id'),true);
        $doneF=array_fill_keys(array_column($this->rows('SELECT task_id FROM refrigerator_task_completions WHERE work_date=?',[$date]),'task_id'),true);
        $result=[];$total=0;$done=0;
        foreach($stations as $station){$n=0;$c=0;foreach($tasks as $t)if($t['station_id']===$station['id']){$n++;$c+=(int)isset($doneS[$t['id']]);}foreach($fridges as $t)if($t['station_id']===$station['id']){$n++;$c+=(int)isset($doneF[$t['id']]);}$result[]=['id'=>$station['id']]+$this->progress($c,$n);$total+=$n;$done+=$c;}
        $extra=$this->one('SELECT COUNT(*) total,COUNT(completed_at) completed FROM additional_tasks WHERE work_date=?',[$date]);return ['stations'=>$result,'overall'=>$this->progress($done+(int)$extra['completed'],$total+(int)$extra['total'])];
    }
    private function adminFields(): array {
        // Types carry validation as well as the UI editor contract. No arbitrary SQL identifiers.
        return [
          'stations'=>['label'=>'Станции','fields'=>['name'=>['Название','text'],'sort_order'=>['Порядок','number']]],
          'users'=>['label'=>'Аккаунты','fields'=>['name'=>['Имя','text'],'login'=>['Логин','text'],'role'=>['Роль','role'],'password'=>['Новый пароль','password']]],
          'station_tasks'=>['label'=>'Задания станций','fields'=>['station_id'=>['Станция','ref:stations'],'title'=>['Задание','text'],'task_type'=>['Тип','tasktype'],'sort_order'=>['Порядок','number'],'is_active'=>['Активно','bool']]],
          'refrigerators'=>['label'=>'Холодильники','fields'=>['number'=>['Номер','positive'],'station_id'=>['Станция','ref:stations']]],
          'refrigerator_tasks'=>['label'=>'Задания холодильников','fields'=>['refrigerator_id'=>['Холодильник','ref:refrigerators'],'title'=>['Задание','text'],'sort_order'=>['Порядок','number']]],
          'additional_task_types'=>['label'=>'Типы дополнительных заданий','fields'=>['title'=>['Название','text'],'is_active'=>['Активно','bool']]],
          'additional_tasks'=>['label'=>'Дополнительные задания','fields'=>['task_type_id'=>['Тип задания','ref:additional_task_types'],'title_snapshot'=>['Название задания','text'],'work_date'=>['Рабочая дата','date'],'completed_by_user_id'=>['Выполнил','optional:users'],'completed_at'=>['Время выполнения (МСК)','time']]],
          'additional_task_assignees'=>['label'=>'Назначения поварам','keys'=>['additional_task_id','user_id'],'fields'=>['additional_task_id'=>['Задание','ref:additional_tasks'],'user_id'=>['Повар','ref:users']]],
          'station_task_completions'=>['label'=>'Выполнения станций и фото','fields'=>['task_id'=>['Задание','ref:station_tasks'],'work_date'=>['Рабочая дата','date'],'completed_by_user_id'=>['Выполнил','optional:users'],'completed_at'=>['Время выполнения (МСК)','time']]],
          'refrigerator_task_completions'=>['label'=>'Выполнения холодильников и фото','fields'=>['task_id'=>['Задание','ref:refrigerator_tasks'],'work_date'=>['Рабочая дата','date'],'completed_by_user_id'=>['Выполнил','optional:users'],'completed_at'=>['Время выполнения (МСК)','time']]],
        ];
    }
    private function adminDate(mixed $v): string {if(!is_string($v)||!preg_match('/^\d{4}-\d{2}-\d{2}$/D',$v))fail('Укажите дату.');$p=DateTimeImmutable::createFromFormat('!Y-m-d',$v);if(!$p||$p->format('Y-m-d')!==$v)fail('Некорректная дата.');return $v;}
    private function adminKey(string $table,string $id): array {
        if($table==='additional_task_assignees'){$p=explode(':',$id);if(count($p)!==2)fail('Некорректная запись.');return ['additional_task_id=? AND user_id=?',array_map($this->id(...),$p)];}
        return ['id=?',[$this->id($id)]];
    }
    private function adminRevision(array $row): string {ksort($row);return hash('sha256',json_encode($row,JSON_THROW_ON_ERROR));}
    private function adminPublic(string $table,array $row): array {
        $row['_revision']=$this->adminRevision($row);
        $row['_key']=$table==='additional_task_assignees'?$row['additional_task_id'].':'.$row['user_id']:$row['id'];
        unset($row['password_hash'],$row['active_login']);
        if(array_key_exists('photo_path',$row)){$row['photoCount']=count($this->photoPaths($row['photo_path']));unset($row['photo_path']);}
        return $row;
    }
    private function adminAudit(array $u,string $action,string $table,string $id,?array $before,?array $after): void {
        // Password hashes never enter the journal, even though the table is administrator-only.
        foreach(['password_hash','password','active_login'] as $field){if($before)unset($before[$field]);if($after)unset($after[$field]);}
        $this->q('INSERT INTO admin_audit (id,actor_id,actor_name,occurred_at,action,table_name,record_id,before_json,after_json) VALUES (?,?,?,?,?,?,?,?,?)',[uuid(),$u['id'],$u['name'],$this->now(),$action,$table,$id,$before?json_encode($before,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR):null,$after?json_encode($after,JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR):null]);
    }
    private function adminRead(array $u,array $d): array {
        $this->requireAdmin($u);$view=$d['view']??'overview';
        if($view==='overview')return ['user'=>$this->view($u),'date'=>$this->date(),'tables'=>$this->adminFields(),'counts'=>['users'=>(int)$this->q('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL')->fetchColumn(),'stations'=>count($this->stations()),'shifts'=>(int)$this->q('SELECT COUNT(*) FROM users WHERE active_station_id IS NOT NULL AND deleted_at IS NULL')->fetchColumn()]];
        $page=filter_var($d['page']??1,FILTER_VALIDATE_INT);if($page===false||$page<1||$page>100000)fail('Некорректная страница.');$offset=($page-1)*50;
        if($view==='records'){
            $table=$d['table']??'';$def=$this->adminFields()[$table]??null;if(!$def)fail('Таблица недоступна.');
            if(!is_string($d['search']??''))fail('Некорректный поиск.');$query=trim($d['search']??'');if(strlen($query)>300)fail('Слишком длинный поиск.');
            $columns=array_values(array_filter(array_keys($def['fields']),fn($k)=>$k!=='password'));$where='1=1';$searchArgs=[];
            if($query!==''){$where='('.implode(' OR ',array_map(fn($k)=>"LOWER(CAST($k AS CHAR)) LIKE LOWER(?)",$columns)).')';$searchArgs=array_fill(0,count($columns),'%'.$query.'%');}
            $total=(int)$this->q("SELECT COUNT(*) FROM $table WHERE $where",$searchArgs)->fetchColumn();$order=$table==='additional_task_assignees'?'additional_task_id,user_id':'id';
            $rows=array_map(fn($r)=>$this->adminPublic($table,$r),$this->rows("SELECT * FROM $table WHERE $where ORDER BY $order LIMIT 50 OFFSET $offset",$searchArgs));
            $objects=$this->rows('SELECT record_id,deleted_work_date FROM admin_objects WHERE table_name=? AND deleted_work_date IS NOT NULL',[$table]);$hidden=array_column($objects,'deleted_work_date','record_id');
            foreach($rows as &$r)$r['_deleted']=$r['deleted_at']??($hidden[$r['_key']]??null);unset($r);
            return ['definition'=>$def,'rows'=>$rows,'total'=>$total,'page'=>$page];
        }
        if($view==='choices'){
            $result=[];foreach($this->adminFields() as $table=>$def){if($table==='additional_task_assignees'||str_ends_with($table,'_completions'))continue;
                $columns=match($table){'users'=>'id,name,login,role,deleted_at','stations'=>'id,name','refrigerators'=>'id,number',default=>'id,'.($table==='additional_tasks'?'title_snapshot':'title')};
                $result[$table]=array_map(fn($r)=>['id'=>$r['id'],'label'=>$r['name']??$r['title']??$r['title_snapshot']??(isset($r['number'])?'№'.$r['number']:'Запись '.substr($r['id'],0,8))],$this->rows("SELECT $columns FROM $table LIMIT 10000"));
            }return $result;
        }
        if($view==='shifts'){
            $from=$this->adminDate($d['from']??$this->offset($this->date(),-6));$to=$this->adminDate($d['to']??$this->date());$active=($d['active']??'')==='1';
            $where=$active?'closed_at IS NULL':'observed_at>=? AND observed_at<?';$args=$active?[]:[$from.'T00:00:00+03:00',$this->offset($to,1).'T00:00:00+03:00'];
            if(!$active)$args=array_map(fn($v)=>$this->now(new DateTimeImmutable($v)),$args);
            $total=(int)$this->q("SELECT COUNT(*) FROM admin_shifts WHERE $where",$args)->fetchColumn();
            return ['rows'=>$this->rows("SELECT * FROM admin_shifts WHERE $where ORDER BY observed_at DESC,id LIMIT 50 OFFSET $offset",$args),'total'=>$total,'page'=>$page];
        }
        if($view==='audit')return ['rows'=>$this->rows("SELECT id,actor_name,occurred_at,action,table_name,record_id FROM admin_audit ORDER BY occurred_at DESC,id LIMIT 50 OFFSET $offset"),'total'=>(int)$this->q('SELECT COUNT(*) FROM admin_audit')->fetchColumn(),'page'=>$page];
        if($view==='security'){
            $calendar=(new DateTimeImmutable('now',new DateTimeZone('Europe/Moscow')))->format('Y-m-d');$from=$this->adminDate($d['from']??$calendar);$to=$this->adminDate($d['to']??$calendar);if($from>$to)fail('Начало периода позже окончания.');
            $args=[$this->now(new DateTimeImmutable($from.'T00:00:00+03:00')),$this->now(new DateTimeImmutable($this->offset($to,1).'T00:00:00+03:00'))];$where='occurred_at>=? AND occurred_at<?';
            if(!empty($d['ip'])){if(!filter_var($d['ip'],FILTER_VALIDATE_IP))fail('Некорректный IP.');$where.=' AND ip=?';$args[]=$d['ip'];}
            if(!empty($d['kind'])){$where.=' AND kind=?';$args[]=$this->text($d['kind'],40);}
            $traffic=$this->rows('SELECT minute_at,SUM(request_count) requests,SUM(error_count) errors,MAX(request_count) peak_ip FROM admin_traffic WHERE minute_at>=? AND minute_at<? GROUP BY minute_at ORDER BY minute_at DESC LIMIT 1440',array_slice($args,0,2));
            return ['rows'=>$this->rows("SELECT * FROM admin_security_events WHERE $where ORDER BY occurred_at DESC LIMIT 50 OFFSET $offset",$args),'total'=>(int)$this->q("SELECT COUNT(*) FROM admin_security_events WHERE $where",$args)->fetchColumn(),'page'=>$page,'traffic'=>$traffic,'coverage'=>'Журнал запросов к API сайта. Запросы к статическим файлам и атаки, остановленные хостингом, сюда не попадают. Всплеск запросов — признак нагрузки, а не доказательство DDoS.'];
        }
        fail('Неизвестный раздел.');
    }
    private function adminWrite(array $u,array $d): array {
        $this->requireAdmin($u);$op=$d['operation']??'';$now=$this->now();$date=$this->date();
        if($op==='closeShift'){
            $id=$this->id($d['id']??null);$s=$this->one('SELECT * FROM admin_shifts WHERE id=?',[$id]);if(!$s)fail('Смена не найдена.',404);if($s['closed_at'])return ['ok'=>true];
            $person=$this->one('SELECT * FROM users WHERE id=?',[$s['user_id']]);$this->recordShift($person,null,$now,'admin');$this->q('UPDATE users SET active_station_id=NULL WHERE id=?',[$person['id']]);$this->adminAudit($u,'closeShift','admin_shifts',$id,$s,['closed_at'=>$now]);return ['ok'=>true];
        }
        $table=$d['table']??'';$def=$this->adminFields()[$table]??null;if(!$def)fail('Таблица недоступна.');
        $id=$d['id']??null;$before=null;$where='';$args=[];
        if($id!==null){if(!is_string($id))fail('Некорректная запись.');[$where,$args]=$this->adminKey($table,$id);$before=$this->one("SELECT * FROM $table WHERE $where",$args);if(!$before)fail('Запись не найдена.',404);if(!is_string($d['revision']??null)||!hash_equals($this->adminRevision($before),$d['revision']))fail('Запись уже изменена. Обновите список и откройте её заново.',409,'STALE_RECORD');}
        if($op==='delete'){
            if(!$before)fail('Выберите запись.');
            if($table==='users'){$manager=$u;$manager['role']='sous_chef';$this->editUser($manager,'deleteUser',['id'=>$id],$now);}
            elseif(in_array($table,['stations','refrigerators','refrigerator_tasks'],true)){
                $this->q('INSERT INTO admin_objects (table_name,record_id,deleted_work_date) VALUES (?,?,?) ON DUPLICATE KEY UPDATE deleted_work_date=VALUES(deleted_work_date)',[$table,$id,$date]);
                if($table==='stations'){foreach($this->rows('SELECT * FROM users WHERE active_station_id=?',[$id]) as $person){$this->recordShift($person,null,$now,'station_removed');$this->q('UPDATE users SET active_station_id=NULL WHERE id=?',[$person['id']]);}}
            }elseif($table==='station_tasks')$this->q('UPDATE station_tasks SET is_active=0,inactive_work_date=? WHERE id=?',[$date,$id]);
            elseif($table==='additional_task_types')$this->q('UPDATE additional_task_types SET is_active=0 WHERE id=?',[$id]);
            else {if($table==='additional_tasks')$this->q('DELETE FROM additional_task_assignees WHERE additional_task_id=?',[$id]);$this->q("DELETE FROM $table WHERE $where",$args);}
            $this->adminAudit($u,'delete',$table,$id,$before,null);$this->adminRecount($before['work_date']??null);return ['ok'=>true];
        }
        if($op!=='save')fail('Неизвестное действие.');$record=$d['record']??null;if(!is_array($record)||array_is_list($record))fail('Неверные поля записи.');
        if(array_diff(array_keys($record),array_keys($def['fields'])))fail('В записи есть недоступные поля.');
        $values=[];
        foreach($def['fields'] as $field=>[$label,$type]){
            $v=$record[$field]??($before[$field]??null);
            if($type==='password'){if($v!==null&&$v!=='')$values[$field]=validPassword($v);continue;}
            if($type==='time'){if($v===null||$v===''){$values[$field]=null;continue;}if(!is_string($v)||!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/D',$v))fail('Укажите корректное время с часовым поясом.');$values[$field]=$this->now(new DateTimeImmutable($v));continue;}
            if(str_starts_with($type,'ref:')||str_starts_with($type,'optional:')){
                if(str_starts_with($type,'optional:')&&($v===null||$v==='')){$values[$field]=null;continue;}
                $ref=explode(':',$type)[1];$v=$this->id($v);if(!$this->one("SELECT id FROM $ref WHERE id=?",[$v]))fail('Связанная запись не найдена.');
                if(in_array($ref,['stations','refrigerators','refrigerator_tasks'],true)&&!$this->one("SELECT id FROM $ref WHERE id=? AND ".$this->adminActiveSql($ref,'id',$date),[$v]))fail('Связанная запись удалена из работы.');
                $values[$field]=$v;continue;
            }
            $values[$field]=match($type){'date'=>$this->adminDate($v),'number','positive'=>$this->adminNumber($v,$type==='positive'?1:0),'bool'=>is_bool($v)?(int)$v:(in_array($v,[0,1],true)?$v:fail('Укажите активность.')),'role'=>is_string($v)&&isset(self::ROLES[$v])?$v:fail('Некорректная роль.'),'tasktype'=>in_array($v,['main','individual'],true)?$v:fail('Некорректный тип.'),default=>$this->text($v,$field==='login'?80:($field==='name'&&$table==='users'?100:300))};
        }
        if($before){
            $parent=match($table){'station_tasks','refrigerators'=>'station_id','refrigerator_tasks'=>'refrigerator_id',default=>null};
            if($parent&&$before[$parent]!==$values[$parent]){
                $hasHistory=match($table){'station_tasks'=>$this->one('SELECT id FROM station_task_completions WHERE task_id=? LIMIT 1',[$id]),'refrigerator_tasks'=>$this->one('SELECT id FROM refrigerator_task_completions WHERE task_id=? LIMIT 1',[$id]),'refrigerators'=>$this->one('SELECT c.id FROM refrigerator_task_completions c JOIN refrigerator_tasks t ON t.id=c.task_id WHERE t.refrigerator_id=? LIMIT 1',[$id])};
                if($hasHistory)fail('У записи есть история выполнений. Для другой станции или холодильника создайте новое задание, чтобы сохранить привязку старых фото.',409);
            }
        }
        if($table==='users'){
            $manager=$u;$manager['role']='sous_chef';$payload=$values;if($id)$payload['id']=$id;$this->editUser($manager,$id?'updateUser':'createUser',$payload,$now);
            $after=$this->one('SELECT * FROM users WHERE login=? AND deleted_at IS NULL',[$values['login']]);$this->adminAudit($u,$before?'update':'create',$table,$after['id'],$before,$after);return ['ok'=>true];
        }
        if($table==='additional_task_assignees'){
            if(!$this->one("SELECT id FROM users WHERE id=? AND role='cook' AND deleted_at IS NULL",[$values['user_id']]))fail('Назначать можно только действующему повару.');
            if($before)$this->q("DELETE FROM $table WHERE $where",$args);
            $this->q('INSERT INTO additional_task_assignees (additional_task_id,user_id) VALUES (?,?)',array_values($values));$id=$values['additional_task_id'].':'.$values['user_id'];
        }else{
            $id??=uuid();
            if($table==='station_tasks'){
                if(!$before){$values['created_work_date']=$date;$values['inactive_work_date']=$values['is_active']?null:$date;}
                elseif((bool)$values['is_active']!==(bool)$before['is_active']){if($values['is_active'])fail('Для повторного добавления создайте новое задание: это сохранит историю.');$values['inactive_work_date']=$date;}
            }
            if(isset($values['completed_at'])){if($values['completed_at']>$now)fail('Время выполнения не может быть в будущем.');if($this->date(new DateTimeImmutable($values['completed_at']))!==$values['work_date'])fail('Время выполнения должно принадлежать выбранному рабочему дню с 04:00 МСК.');}
            if(str_ends_with($table,'_completions')||$table==='additional_tasks'){
                $photo=$before['photo_path']??null;if(isset($d['photosBase64']))$photo=$this->adminStorePhotos($d['photosBase64']);
                if(str_ends_with($table,'_completions')&&(!$photo||!$values['completed_at']))fail('Для выполнения нужны фото и время.');
                if($table==='additional_tasks'&&(bool)$photo!==(bool)$values['completed_at'])fail('У выполненного задания должны быть фото и время.');
                $values['photo_path']=$photo;
                if(!$values['completed_at'])$values['completed_by_user_id']=null;
            }
            if($before){$set=implode(',',array_map(fn($k)=>"$k=?",array_keys($values)));$this->q("UPDATE $table SET $set WHERE id=?",[...array_values($values),$id]);}
            else{$values=['id'=>$id]+$values;$cols=implode(',',array_keys($values));$marks=implode(',',array_fill(0,count($values),'?'));$this->q("INSERT INTO $table ($cols) VALUES ($marks)",array_values($values));if(in_array($table,['stations','refrigerators','refrigerator_tasks'],true))$this->q('INSERT INTO admin_objects (table_name,record_id,created_work_date) VALUES (?,?,?)',[$table,$id,$date]);}
        }
        [$w,$a]=$this->adminKey($table,$id);$after=$this->one("SELECT * FROM $table WHERE $w",$a);$this->adminAudit($u,$before?'update':'create',$table,$id,$before,$after);
        $this->adminRecount($before['work_date']??null);$this->adminRecount($after['work_date']??null);return ['ok'=>true,'id'=>$id];
    }
    private function adminNumber(mixed $v,int $min): int {if(!is_int($v)||$v<$min||$v>1000000)fail('Некорректное число.');return $v;}
    private function adminStorePhotos(mixed $images): string {
        if(!is_array($images)||!array_is_list($images)||count($images)<1||count($images)>4)fail('Прикрепите от 1 до 4 фотографий.');$decoded=[];
        foreach($images as $image){if(!is_string($image)||strlen($image)>4*1024*1024)fail('Некорректная фотография.');$bytes=base64_decode($image,true);if($bytes===false)fail('Некорректная фотография.');$this->validateWebp($bytes);$decoded[]=$bytes;}
        $dir=$this->config['photo_dir'];if(!is_dir($dir)&&!mkdir($dir,0700,true))fail('Не удалось создать папку фото.',503);$paths=[];
        foreach($decoded as $bytes){$name=uuid().'.webp';$path=$dir.'/'.$name;$f=fopen($path,'xb');if(!$f)fail('Не удалось сохранить фото.',503);$this->createdPhotos[]=$path;try{if(!chmod($path,0600)||fwrite($f,$bytes)!==strlen($bytes)||!fflush($f))fail('Не удалось сохранить фото.',503);}finally{fclose($f);}$paths[]='local:'.$name;}
        return count($paths)===1?$paths[0]:json_encode($paths,JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR);
    }
    private function adminRecount(?string $day): void {
        if(!$day||$day>=$this->date()||$day<$this->offset($this->date(),-32))return;
        $p=$this->counts($day);$this->q('DELETE FROM daily_station_statistics WHERE work_date=?',[$day]);$this->q('DELETE FROM daily_statistics WHERE work_date=?',[$day]);
        foreach($p['stations'] as $s)$this->q('INSERT INTO daily_station_statistics (work_date,station_id,completed_tasks,total_tasks) VALUES (?,?,?,?)',[$day,$s['id'],$s['completed'],$s['total']]);
        $this->q('INSERT INTO daily_statistics (work_date,completed_tasks,total_tasks) VALUES (?,?,?)',[$day,$p['overall']['completed'],$p['overall']['total']]);
    }
}
