package api

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"mydash/backend/internal/db"
)

func newTestHandler(t *testing.T) (*NoteHandler, *sql.DB, int64) {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	now := nowRFC()
	res, err := d.Exec(
		"INSERT INTO notes (folder_id, title, content, sort, created_at, updated_at) VALUES (NULL, '测试', 'v0', 0, ?, ?)",
		now, now,
	)
	if err != nil {
		t.Fatalf("insert note: %v", err)
	}
	id, _ := res.LastInsertId()
	return NewNoteHandler(d), d, id
}

func countAuto(t *testing.T, d *sql.DB, noteID int64) int {
	t.Helper()
	var n int
	if err := d.QueryRow("SELECT COUNT(*) FROM note_versions WHERE note_id = ? AND auto = 1", noteID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// 同一编辑会话内连续保存多次，只应产生 1 个检查点。
func TestVersionPolicySessionMerge(t *testing.T) {
	h, d, noteID := newTestHandler(t)
	for i := 0; i < 5; i++ {
		h.autoVersion(noteID, fmt.Sprintf("content-%d", i))
	}
	if got := countAuto(t, d, noteID); got != 1 {
		t.Fatalf("会话合并失败：期望 1 条自动版本，实际 %d", got)
	}
}

// 分层保留：近期全留、中段按桶压缩、超期删除、手动版本永久。
func TestVersionPolicyTieredRetention(t *testing.T) {
	h, d, noteID := newTestHandler(t)
	now := time.Now().UTC()
	ins := func(auto int, at time.Time, content string) {
		if _, err := d.Exec(
			"INSERT INTO note_versions (note_id, label, auto, content, created_at) VALUES (?, '', ?, ?, ?)",
			noteID, auto, content, at.Format(time.RFC3339),
		); err != nil {
			t.Fatalf("insert version: %v", err)
		}
	}
	// 2 小时内 3 条 → 全留
	for i := 0; i < 3; i++ {
		ins(1, now.Add(-time.Duration(i+1)*10*time.Minute), fmt.Sprintf("recent-%d", i))
	}
	// 约 2~3 小时前 6 条（10 分钟间隔）→ 压到每 30 分钟 1 条
	for i := 0; i < 6; i++ {
		ins(1, now.Add(-time.Duration(130+i*10)*time.Minute), fmt.Sprintf("mid-%d", i))
	}
	// 40 天前 → 删除
	ins(1, now.AddDate(0, 0, -40), "expired")
	// 100 天前的手动版本 → 永久保留
	ins(0, now.AddDate(0, 0, -100), "manual-old")

	h.pruneVersions(noteID)

	var recent, mid, expired, manual int
	_ = d.QueryRow("SELECT COUNT(*) FROM note_versions WHERE note_id=? AND auto=1 AND content LIKE 'recent-%'", noteID).Scan(&recent)
	_ = d.QueryRow("SELECT COUNT(*) FROM note_versions WHERE note_id=? AND auto=1 AND content LIKE 'mid-%'", noteID).Scan(&mid)
	_ = d.QueryRow("SELECT COUNT(*) FROM note_versions WHERE note_id=? AND content='expired'", noteID).Scan(&expired)
	_ = d.QueryRow("SELECT COUNT(*) FROM note_versions WHERE note_id=? AND auto=0", noteID).Scan(&manual)

	if recent != 3 {
		t.Errorf("2 小时内应全留 3 条，实际 %d", recent)
	}
	if mid < 2 || mid > 4 {
		t.Errorf("2~3 小时应压缩到 2~4 条，实际 %d", mid)
	}
	if expired != 0 {
		t.Errorf("超 30 天的自动版本应删除，实际 %d", expired)
	}
	if manual != 1 {
		t.Errorf("手动版本应永久保留，实际 %d", manual)
	}
}
