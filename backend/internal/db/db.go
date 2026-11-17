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
	return nil
}
