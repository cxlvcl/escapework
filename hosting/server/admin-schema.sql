CREATE TABLE IF NOT EXISTS admin_members (
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 granted_at CHAR(24) CHARACTER SET ascii NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_objects (
 table_name VARCHAR(40) CHARACTER SET ascii NOT NULL,
 record_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_work_date DATE NULL, deleted_work_date DATE NULL,
 PRIMARY KEY(table_name,record_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_shifts (
 id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
 user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 station_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 user_name VARCHAR(100) NOT NULL, station_name VARCHAR(300) NOT NULL,
 opened_at CHAR(24) CHARACTER SET ascii NULL,
 observed_at CHAR(24) CHARACTER SET ascii NOT NULL,
 closed_at CHAR(24) CHARACTER SET ascii NULL,
 close_reason VARCHAR(40) NOT NULL DEFAULT '',
 KEY shifts_user(user_id,closed_at), KEY shifts_time(observed_at),
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(station_id) REFERENCES stations(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_audit (
 id CHAR(36) CHARACTER SET ascii PRIMARY KEY,
 actor_id CHAR(36) CHARACTER SET ascii NOT NULL, actor_name VARCHAR(100) NOT NULL,
 occurred_at CHAR(24) CHARACTER SET ascii NOT NULL,
 action VARCHAR(40) NOT NULL, table_name VARCHAR(40) NOT NULL, record_id VARCHAR(100) NOT NULL,
 before_json MEDIUMTEXT NULL, after_json MEDIUMTEXT NULL,
 KEY audit_time(occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_security_events (
 id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 occurred_at CHAR(24) CHARACTER SET ascii NOT NULL,
 ip VARCHAR(45) CHARACTER SET ascii NOT NULL, kind VARCHAR(40) NOT NULL,
 status INT NOT NULL, login VARCHAR(80) NOT NULL, path VARCHAR(100) NOT NULL,
 user_agent VARCHAR(250) NOT NULL, event_count INT NOT NULL DEFAULT 1,
 KEY security_time(occurred_at), KEY security_ip(ip,occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS admin_traffic (
 id CHAR(64) CHARACTER SET ascii PRIMARY KEY,
 minute_at CHAR(24) CHARACTER SET ascii NOT NULL,
 ip VARCHAR(45) CHARACTER SET ascii NOT NULL, request_count INT NOT NULL DEFAULT 1,
 error_count INT NOT NULL DEFAULT 0,
 KEY traffic_time(minute_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
