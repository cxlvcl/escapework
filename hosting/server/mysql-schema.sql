-- Import into a NEW EMPTY database. Deliberately no DROP / IF NOT EXISTS.
-- MySQL 8 / MariaDB, InnoDB. Runtime account needs SELECT, INSERT, UPDATE, DELETE only.
SET NAMES utf8mb4;
CREATE TABLE stations (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(300) NOT NULL, sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE users (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 name VARCHAR(100) NOT NULL, login VARCHAR(80) NOT NULL, password_hash VARCHAR(255) NOT NULL,
 role ENUM('cook','sous_chef','chef','audit') NOT NULL,
 active_station_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 deleted_at CHAR(24) CHARACTER SET ascii NULL,
 active_login VARCHAR(80) GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN login ELSE NULL END) STORED,
 UNIQUE KEY unique_active_login(active_login), KEY users_role(role,deleted_at),
 FOREIGN KEY(active_station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE station_tasks (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 station_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 title VARCHAR(300) NOT NULL, task_type ENUM('main','individual') NOT NULL,
 sort_order INT NOT NULL, is_active BOOLEAN NOT NULL,
 created_work_date DATE NOT NULL, inactive_work_date DATE NULL,
 KEY station_active(station_id,is_active,sort_order),
 FOREIGN KEY(station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE refrigerators (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 number INT NOT NULL UNIQUE,
 station_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 FOREIGN KEY(station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE refrigerator_tasks (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 refrigerator_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 title VARCHAR(300) NOT NULL, sort_order INT NOT NULL,
 FOREIGN KEY(refrigerator_id) REFERENCES refrigerators(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE station_task_completions (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 work_date DATE NOT NULL, photo_path TEXT NOT NULL,
 completed_at CHAR(24) CHARACTER SET ascii NOT NULL,
 completed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY task_day(task_id,work_date), KEY activity(completed_by_user_id,completed_at), KEY day_lookup(work_date),
 FOREIGN KEY(task_id) REFERENCES station_tasks(id), FOREIGN KEY(completed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE refrigerator_task_completions (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 work_date DATE NOT NULL, photo_path TEXT NOT NULL,
 completed_at CHAR(24) CHARACTER SET ascii NOT NULL,
 completed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY task_day(task_id,work_date), KEY activity(completed_by_user_id,completed_at), KEY day_lookup(work_date),
 FOREIGN KEY(task_id) REFERENCES refrigerator_tasks(id), FOREIGN KEY(completed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE additional_task_types (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 title VARCHAR(300) NOT NULL, is_active BOOLEAN NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE additional_tasks (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 task_type_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 work_date DATE NOT NULL, photo_path TEXT NULL,
 completed_at CHAR(24) CHARACTER SET ascii NULL,
 completed_by_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 title_snapshot VARCHAR(300) NULL,
 KEY day_lookup(work_date), KEY activity(completed_by_user_id,completed_at),
 FOREIGN KEY(task_type_id) REFERENCES additional_task_types(id), FOREIGN KEY(completed_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE additional_task_assignees (
 additional_task_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 PRIMARY KEY(additional_task_id,user_id), KEY user_tasks(user_id,additional_task_id),
 FOREIGN KEY(additional_task_id) REFERENCES additional_tasks(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE daily_statistics (
 work_date DATE PRIMARY KEY, completed_tasks INT UNSIGNED NOT NULL, total_tasks INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE daily_station_statistics (
 work_date DATE NOT NULL, station_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 completed_tasks INT UNSIGNED NOT NULL,total_tasks INT UNSIGNED NOT NULL,
 PRIMARY KEY(work_date,station_id), FOREIGN KEY(station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 expires_at CHAR(24) CHARACTER SET ascii NOT NULL,
 KEY expiry(expires_at), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE login_attempts (
 `key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL, reset_at CHAR(24) CHARACTER SET ascii NOT NULL, KEY expiry(reset_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE operations (
 id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 response MEDIUMTEXT NOT NULL, expires_at CHAR(24) CHARACTER SET ascii NOT NULL, KEY expiry(expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE app_mutex(id INT PRIMARY KEY) ENGINE=InnoDB;
INSERT INTO app_mutex VALUES(1);
CREATE TABLE migration_receipt (
 id INT PRIMARY KEY, source_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 imported_at CHAR(24) CHARACTER SET ascii NOT NULL, counts_json TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
