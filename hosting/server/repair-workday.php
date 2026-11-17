<?php
declare(strict_types=1);

// One-time repair of records written by the midnight-based backend.
// Upload beside config.php in escape-private. No HTTP entry point.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

final class WorkdayRepairError extends RuntimeException {}

final class WorkdayRepair {
    private const TABLES = [
        'station' => 'station_task_completions',
        'refrigerator' => 'refrigerator_task_completions',
        'additional' => 'additional_tasks',
    ];
    public ?string $backupPath = null;

    public function __construct(private PDO $db, private string $backupDirectory) {}

    private function query(string $sql, array $args = []): PDOStatement {
        $statement = $this->db->prepare($sql);
        $statement->execute($args);
        return $statement;
    }

    private function rows(string $sql, array $args = []): array {
        return $this->query($sql, $args)->fetchAll(PDO::FETCH_ASSOC);
    }

    public function run(string $sourceDate, bool $apply = false, ?DateTimeImmutable $now = null): array {
        $this->backupPath = null;
        $moscow = new DateTimeZone('Europe/Moscow');
        $start = DateTimeImmutable::createFromFormat('!Y-m-d', $sourceDate, $moscow);
        if (!$start || $start->format('Y-m-d') !== $sourceDate) {
            throw new WorkdayRepairError('Укажите календарную дату ночных выполнений в формате YYYY-MM-DD.');
        }
        $now ??= new DateTimeImmutable('now', $moscow);
        $today = $now->setTimezone($moscow)->modify('-4 hours')->format('Y-m-d');
        $targetDate = $start->modify('-1 day')->format('Y-m-d');
        if ($sourceDate > $today || $targetDate < (new DateTimeImmutable($today, $moscow))->modify('-32 days')->format('Y-m-d')) {
            throw new WorkdayRepairError('Ночной интервал должен уже закончиться и находиться в пределах последних 32 рабочих дней.');
        }
        $utc = new DateTimeZone('UTC');
        $from = $start->setTimezone($utc)->format('Y-m-d\TH:i:s.v\Z');
        $until = $start->modify('+4 hours')->setTimezone($utc)->format('Y-m-d\TH:i:s.v\Z');

        $this->db->beginTransaction();
        try {
            if ($this->query('SELECT id FROM app_mutex WHERE id=1 FOR UPDATE')->fetchColumn() === false) {
                throw new WorkdayRepairError('Не найдена блокировка приложения app_mutex.');
            }
            $changes = [];
            $conflicts = [];
            $taskChanges = [];
            foreach (self::TABLES as $category => $table) {
                // Both the old work date AND actual timestamp must match this one night.
                $changes[$category] = $this->rows("SELECT * FROM $table WHERE work_date=? AND completed_at>=? AND completed_at<? ORDER BY id", [$sourceDate, $from, $until]);
                $conflicts[$category] = 0;
                foreach ($changes[$category] as $row) {
                    if ($category !== 'additional' && $this->query("SELECT id FROM $table WHERE task_id=? AND work_date=?", [$row['task_id'], $targetDate])->fetchColumn() !== false) {
                        $conflicts[$category]++;
                    }
                    if ($category === 'station') {
                        $task = $this->query('SELECT * FROM station_tasks WHERE id=?', [$row['task_id']])->fetch(PDO::FETCH_ASSOC);
                        if (!$task || $task['created_work_date'] > $sourceDate) {
                            throw new WorkdayRepairError('История создания станционной задачи не соответствует выполнению. Требуется проверка данных.');
                        }
                        // A task completed before 04:00 necessarily existed in the preceding workday.
                        if ($task['created_work_date'] === $sourceDate) $taskChanges[$task['id']] = $task;
                    }
                }
            }
            $counts = array_map('count', $changes);
            $report = [
                'success' => true,
                'mode' => $apply ? 'apply' : 'preview',
                'fromWorkDate' => $sourceDate,
                'toWorkDate' => $targetDate,
                'moscowInterval' => "$sourceDate 00:00:00 <= время < 04:00:00",
                'completions' => $counts,
                'duplicateTasks' => $conflicts,
                'taskStartDates' => count($taskChanges),
                'canApply' => array_sum($conflicts) === 0,
            ];
            if (!$apply) {
                $this->db->rollBack();
                return $report;
            }
            if (!$report['canApply']) {
                throw new WorkdayRepairError('В предыдущем рабочем дне уже есть выполнения этих задач. Перенос остановлен до разрешения повторов; записи и фото не изменены.');
            }
            if (array_sum($counts) === 0) {
                $this->db->rollBack();
                return $report + ['changed' => false, 'recalculatedDates' => []];
            }
            $statisticsBefore = [];
            foreach (['daily_statistics', 'daily_station_statistics'] as $table) {
                $statisticsBefore[$table] = $this->rows("SELECT * FROM $table WHERE work_date IN (?,?)", [$targetDate, $sourceDate]);
            }
            $this->saveBackup([
                'format' => 'escape-workday-repair-v1',
                'createdAt' => $now->setTimezone($utc)->format('Y-m-d\TH:i:s.v\Z'),
                'fromWorkDate' => $sourceDate,
                'toWorkDate' => $targetDate,
                'completionsBefore' => $changes,
                'stationTasksBefore' => array_values($taskChanges),
                'statisticsBefore' => $statisticsBefore,
            ]);
            foreach (self::TABLES as $category => $table) {
                foreach ($changes[$category] as $row) {
                    $this->query("UPDATE $table SET work_date=? WHERE id=? AND work_date=?", [$targetDate, $row['id'], $sourceDate]);
                }
            }
            foreach ($taskChanges as $task) {
                $this->query('UPDATE station_tasks SET created_work_date=? WHERE id=?', [$targetDate, $task['id']]);
            }
            $recalculated = [];
            foreach ([$targetDate, $sourceDate] as $date) {
                // Correct only the affected dates; an active date must remain live.
                foreach (['daily_station_statistics', 'daily_statistics'] as $table) {
                    $this->query("DELETE FROM $table WHERE work_date=?", [$date]);
                }
                if ($date < $today) {
                    $this->saveStatistics($date);
                    $recalculated[] = $date;
                }
            }
            $this->db->commit();
            return $report + ['changed' => true, 'recalculatedDates' => $recalculated, 'backup' => $this->backupPath];
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) $this->db->rollBack();
            throw $error;
        }
    }

    private function saveStatistics(string $date): void {
        // Same task validity and station/extra separation as MysqlBackend::counts().
        $stations = $this->rows('SELECT s.id, (SELECT COUNT(*) FROM station_tasks t WHERE t.station_id=s.id AND t.created_work_date<=? AND (t.inactive_work_date IS NULL OR t.inactive_work_date>?)) + (SELECT COUNT(*) FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id WHERE r.station_id=s.id) AS total, (SELECT COUNT(*) FROM station_tasks t JOIN station_task_completions c ON c.task_id=t.id AND c.work_date=? WHERE t.station_id=s.id AND t.created_work_date<=? AND (t.inactive_work_date IS NULL OR t.inactive_work_date>?)) + (SELECT COUNT(*) FROM refrigerator_tasks t JOIN refrigerators r ON r.id=t.refrigerator_id JOIN refrigerator_task_completions c ON c.task_id=t.id AND c.work_date=? WHERE r.station_id=s.id) AS completed FROM stations s ORDER BY s.sort_order,s.id', [$date, $date, $date, $date, $date, $date]);
        $total = 0;
        $completed = 0;
        foreach ($stations as $station) {
            $total += (int)$station['total'];
            $completed += (int)$station['completed'];
            $this->query('INSERT INTO daily_station_statistics (work_date,station_id,completed_tasks,total_tasks) VALUES (?,?,?,?)', [$date, $station['id'], (int)$station['completed'], (int)$station['total']]);
        }
        $extra = $this->query('SELECT COUNT(*) total,COUNT(completed_at) completed FROM additional_tasks WHERE work_date=?', [$date])->fetch(PDO::FETCH_ASSOC);
        $this->query('INSERT INTO daily_statistics (work_date,completed_tasks,total_tasks) VALUES (?,?,?)', [$date, $completed + (int)$extra['completed'], $total + (int)$extra['total']]);
    }

    private function saveBackup(array $data): void {
        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
        $path = $this->backupDirectory.'/workday-repair-backup-'.gmdate('Ymd-His').'-'.bin2hex(random_bytes(6)).'.json';
        $mask = umask(0077);
        try { $file = @fopen($path, 'xb'); } finally { umask($mask); }
        if (!$file) throw new WorkdayRepairError('Не удалось создать приватную резервную копию. Данные не изменены.');
        try {
            if (!chmod($path, 0600) || fwrite($file, $json) !== strlen($json) || !fflush($file) || (function_exists('fsync') && !fsync($file))) {
                throw new WorkdayRepairError('Не удалось полностью сохранить резервную копию. Данные не изменены.');
            }
        } finally { fclose($file); }
        $this->backupPath = $path;
    }
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    ini_set('display_errors', '0');
    $repair = null;
    try {
        if ($argc < 2 || $argc > 3 || ($argc === 3 && $argv[2] !== '--apply')) {
            throw new WorkdayRepairError('Проверка: php repair-workday.php YYYY-MM-DD; перенос: добавьте --apply.');
        }
        $config = require __DIR__.'/config.php';
        if (($config['backend'] ?? '') !== 'mysql') throw new WorkdayRepairError('Эта процедура предназначена только для DB_BACKEND=mysql.');
        $pdo = new PDO($config['db_dsn'], $config['db_user'], $config['db_password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        $pdo->exec("SET time_zone = '+00:00'");
        $repair = new WorkdayRepair($pdo, __DIR__);
        echo json_encode($repair->run($argv[1], $argc === 3), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR).PHP_EOL;
    } catch (Throwable $error) {
        $message = $error instanceof WorkdayRepairError ? $error->getMessage() : 'Перенос не подтверждён. Требуется проверить ошибку подключения или записи в MySQL.';
        fwrite(STDERR, json_encode(['success' => false, 'error' => $message, 'backup' => $repair?->backupPath], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT).PHP_EOL);
        exit(1);
    }
}
