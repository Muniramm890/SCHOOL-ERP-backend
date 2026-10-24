/* Login tracking: who logged in, when, from which device/location, remote logout.
   Safe to run many times (idempotent). The backend also creates these lazily on first login, so running this is optional. */

IF OBJECT_ID(N'dbo.login_sessions', N'U') IS NULL
CREATE TABLE dbo.login_sessions (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT DF_login_sessions_id DEFAULT NEWID() CONSTRAINT PK_login_sessions PRIMARY KEY,
  school_id UNIQUEIDENTIFIER NOT NULL,
  principal_type VARCHAR(10) NOT NULL,            -- 'staff' (users: teachers, drivers, accountants...) | 'student'
  user_id UNIQUEIDENTIFIER NULL,                  -- users.id            (staff)
  student_id UNIQUEIDENTIFIER NULL,               -- students.id         (student)
  display_name NVARCHAR(200) NULL,
  role VARCHAR(40) NULL,
  device_id NVARCHAR(100) NULL,                   -- stable id sent by the app (optional)
  device_name NVARCHAR(150) NULL,                 -- "Samsung SM-A135F" / "Chrome on Windows 10/11"
  platform VARCHAR(20) NULL,                      -- android | ios | web
  os NVARCHAR(60) NULL,
  browser NVARCHAR(60) NULL,
  app_version NVARCHAR(30) NULL,
  ip_address VARCHAR(64) NULL,
  geo_city NVARCHAR(100) NULL, geo_region NVARCHAR(100) NULL, geo_country NVARCHAR(100) NULL,   -- from IP (approximate)
  latitude DECIMAL(9,6) NULL, longitude DECIMAL(9,6) NULL, location_accuracy_m DECIMAL(8,1) NULL,
  location_source VARCHAR(10) NULL,               -- gps | ip
  user_agent NVARCHAR(400) NULL,
  login_at DATETIME2 NOT NULL CONSTRAINT DF_login_sessions_login DEFAULT SYSUTCDATETIME(),
  last_seen_at DATETIME2 NULL,
  expires_at DATETIME2 NULL,
  ended_at DATETIME2 NULL,
  end_reason VARCHAR(20) NULL,                    -- logout | remote | password_changed
  revoked_by_user_id UNIQUEIDENTIFIER NULL,
  revoked_by_name NVARCHAR(200) NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_school_time' AND object_id = OBJECT_ID(N'dbo.login_sessions'))
  CREATE INDEX IX_login_sessions_school_time ON dbo.login_sessions (school_id, login_at DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_user' AND object_id = OBJECT_ID(N'dbo.login_sessions'))
  CREATE INDEX IX_login_sessions_user ON dbo.login_sessions (user_id, ended_at);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_sessions_student' AND object_id = OBJECT_ID(N'dbo.login_sessions'))
  CREATE INDEX IX_login_sessions_student ON dbo.login_sessions (student_id, ended_at);

IF OBJECT_ID(N'dbo.login_failures', N'U') IS NULL
CREATE TABLE dbo.login_failures (
  id BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_login_failures PRIMARY KEY,
  school_id UNIQUEIDENTIFIER NULL,
  principal_type VARCHAR(10) NOT NULL,
  identifier NVARCHAR(255) NULL,                  -- email / phone typed on the login screen
  reason VARCHAR(30) NULL,                        -- user_not_found | wrong_password | inactive
  ip_address VARCHAR(64) NULL,
  device_name NVARCHAR(150) NULL,
  platform VARCHAR(20) NULL,
  user_agent NVARCHAR(400) NULL,
  created_at DATETIME2 NOT NULL CONSTRAINT DF_login_failures_created DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_login_failures_time' AND object_id = OBJECT_ID(N'dbo.login_failures'))
  CREATE INDEX IX_login_failures_time ON dbo.login_failures (school_id, created_at DESC);
