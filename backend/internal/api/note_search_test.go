package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"mydash/backend/internal/db"
)

// 中文按 rune 截取，不能切断 UTF-8；边界处补省略号。
func TestSnippetAround(t *testing.T) {
	content := "abcdefghij周报模板klmnopqrst"
	got := snippetAround(content, "周报", 3)
	// 命中前 3 个 rune + 关键词 2 个 rune + 命中后 3 个 rune
	if got != "…hij周报模板k…" {
		t.Fatalf("片段不符合预期: %q", got)
	}
	if snippetAround("没有关键词", "周报", 3) != "" {
		t.Fatal("未命中时应返回空串")
	}
	// 命中在开头/结尾时不补对应省略号
	if s := snippetAround("周报模板内容", "周报", 3); strings.HasPrefix(s, "…") {
		t.Fatalf("开头命中不应有前置省略号: %q", s)
	}
}

func TestNoteSearch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	d, err := db.Open(filepath.Join(t.TempDir(), "search.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	notes := []struct{ title, content string }{
		{"周报模板", "本周完成了三件事，下周计划继续推进。"},
		{"会议纪要", "讨论了周报的格式，决定每周五提交。"},
		{"读书笔记", "与工作无关的内容。"},
	}
	for i, n := range notes {
		now := nowRFC()
		if _, err := d.Exec(
			"INSERT INTO notes (folder_id, title, content, sort, created_at, updated_at) VALUES (NULL, ?, ?, ?, ?, ?)",
			n.title, n.content, i, now, now,
		); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}

	h := NewNoteHandler(d)
	r := gin.New()
	r.GET("/search", h.Search)

	// 标题命中 + 正文命中都应返回
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/search?q=%E5%91%A8%E6%8A%A5", nil))
	var resp struct {
		Code int             `json:"code"`
		Data []NoteSearchHit `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("解析响应失败: %v, body=%s", err, w.Body.String())
	}
	if resp.Code != 0 {
		t.Fatalf("code=%d body=%s", resp.Code, w.Body.String())
	}
	if len(resp.Data) != 2 {
		t.Fatalf("期望 2 条命中，实际 %d: %s", len(resp.Data), w.Body.String())
	}
	// 标题命中的那条没有正文片段，正文命中的那条应有片段
	withSnippet := 0
	for _, hit := range resp.Data {
		if hit.Snippet != "" {
			withSnippet++
			if !strings.Contains(hit.Snippet, "周报") {
				t.Fatalf("片段不含关键词: %q", hit.Snippet)
			}
		}
	}
	if withSnippet != 1 {
		t.Fatalf("期望恰好 1 条带正文片段，实际 %d", withSnippet)
	}

	// 空查询返回空数组
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/search?q=", nil))
	if !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Fatalf("空查询应返回空数组: %s", w.Body.String())
	}
}
