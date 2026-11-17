// Package db 负责 SQLite 的打开与结构迁移。
package db

import (
	"database/sql"
	"fmt"
	"path/filepath"

	// 注册 modernc.org/sqlite 驱动（纯 Go 实现，driver name 为 "sqlite"）
	_ "modernc.org/sqlite"
)

// Open 打开 SQLite 数据库，启用 WAL、忙等待超时与外键约束。
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", filepath.ToSlash(path))
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite 单写多读，限制连接数避免并发写时的 busy 错误
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return d, nil
}

// Migrate 使用 PRAGMA user_version 做最简版本迁移，新业务表按版本号往下加。
func Migrate(d *sql.DB) error {
	var version int
	if err := d.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}

	if version < 1 {
		stmts := []string{
			`CREATE TABLE IF NOT EXISTS notes (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				title      TEXT NOT NULL,
				content    TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
		}
		for _, s := range stmts {
			if _, err := d.Exec(s); err != nil {
				return fmt.Errorf("migrate v1: %w", err)
			}
		}
		if _, err := d.Exec("PRAGMA user_version = 1"); err != nil {
			return fmt.Errorf("set user_version: %w", err)
		}
	}

	if version < 2 {
		// v2：笔记升级为 Markdown 笔记（树形文件夹 + 内容 + 版本表），旧平铺数据平移
		stmts := []string{
			`ALTER TABLE notes RENAME TO notes_v1`,
			`CREATE TABLE folders (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				name       TEXT NOT NULL,
				parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
				sort       INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE TABLE notes (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				folder_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
				title      TEXT NOT NULL,
				content    TEXT NOT NULL DEFAULT '',
				sort       INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE TABLE note_versions (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
				label      TEXT NOT NULL DEFAULT '',
				auto       INTEGER NOT NULL DEFAULT 1,
				content    TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX idx_notes_folder ON notes(folder_id)`,
			`CREATE INDEX idx_versions_note ON note_versions(note_id)`,
			`INSERT INTO notes (id, folder_id, title, content, sort, created_at, updated_at)
				SELECT id, NULL, title, content, 0, created_at, updated_at FROM notes_v1`,
			`DROP TABLE notes_v1`,
		}
		for _, s := range stmts {
			if _, err := d.Exec(s); err != nil {
				return fmt.Errorf("migrate v2: %w", err)
			}
		}
		if _, err := d.Exec("PRAGMA user_version = 2"); err != nil {
			return fmt.Errorf("set user_version: %w", err)
		}
	}
	if version < 3 {
		// v3：待办模块（分类 / 待办 / 标签 / 待办-标签 / 评论）
		stmts := []string{
			`CREATE TABLE todo_categories (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				name       TEXT NOT NULL,
				sort       INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
			`CREATE TABLE todos (
				id           INTEGER PRIMARY KEY AUTOINCREMENT,
				category_id  INTEGER REFERENCES todo_categories(id) ON DELETE SET NULL,
				parent_id    INTEGER REFERENCES todos(id) ON DELETE CASCADE,
				title        TEXT NOT NULL,
				subtitle     TEXT NOT NULL DEFAULT '',
				description  TEXT NOT NULL DEFAULT '',
				priority     INTEGER NOT NULL DEFAULT 4,
				status       TEXT NOT NULL DEFAULT 'open',
				start_at     TEXT,
				due_at       TEXT,
				warn_minutes INTEGER,
				sort         INTEGER NOT NULL DEFAULT 0,
				completed_at TEXT,
				created_at   TEXT NOT NULL,
				updated_at   TEXT NOT NULL
			)`,
			`CREATE TABLE todo_tags (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				name       TEXT NOT NULL UNIQUE,
				created_at TEXT NOT NULL
			)`,
			`CREATE TABLE todo_todo_tag (
				todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
				tag_id  INTEGER NOT NULL REFERENCES todo_tags(id) ON DELETE CASCADE,
				PRIMARY KEY (todo_id, tag_id)
			)`,
			`CREATE TABLE todo_comments (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				todo_id    INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
				content    TEXT NOT NULL,
				created_at TEXT NOT NULL
			)`,
			`CREATE INDEX idx_todos_category ON todos(category_id)`,
			`CREATE INDEX idx_todos_parent ON todos(parent_id)`,
			`CREATE INDEX idx_todo_tag_tag ON todo_todo_tag(tag_id)`,
			`CREATE INDEX idx_comments_todo ON todo_comments(todo_id)`,
		}
		for _, s := range stmts {
			if _, err := d.Exec(s); err != nil {
				return fmt.Errorf("migrate v3: %w", err)
			}
		}
		if _, err := d.Exec("PRAGMA user_version = 3"); err != nil {
			return fmt.Errorf("set user_version: %w", err)
		}
	}
	return nil
}
