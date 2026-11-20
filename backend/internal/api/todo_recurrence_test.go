package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"mydash/backend/internal/db"
)

func newTodoTestEnv(t *testing.T) (*TodoHandler, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	d, err := db.Open(filepath.Join(t.TempDir(), "todos.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := db.Migrate(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	h := NewTodoHandler(d)
	r := gin.New()
	r.POST("/api/todos", h.Create)
	r.POST("/api/todos/:id/status", h.SetStatus)
	r.DELETE("/api/todos/:id", h.Delete)
	r.POST("/api/todos/:id/restore", h.Restore)
	r.POST("/api/todos/:id/purge", h.Purge)
	r.GET("/api/todos", h.List)
	r.GET("/api/todos/trash", h.ListTrash)
	r.POST("/api/todos/batch", h.Batch)
	r.POST("/api/todos/sort", h.Sort)
	return h, r
}

func doJSON(t *testing.T, r *gin.Engine, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == nil {
		reader = strings.NewReader("")
	} else {
		b, _ := json.Marshal(body)
		reader = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// nextOccurrence 各规则的时间推进与无日期时不生成
func TestNextOccurrence(t *testing.T) {
	base := "2026-11-16T09:00:00Z"
	todo := Todo{RecType: "weekly", RecInterval: 1, DueAt: &base}
	nextStart, nextDue, ok := nextOccurrence(todo)
	if !ok || nextStart != nil || nextDue == nil {
		t.Fatalf("weekly 应推进 due: ok=%v start=%v due=%v", ok, nextStart, nextDue)
	}
	want := "2026-11-23T09:00:00Z"
	if *nextDue != want {
		t.Fatalf("weekly 下一期应为 %s，得到 %s", want, *nextDue)
	}

	todo = Todo{RecType: "daily", RecInterval: 3, DueAt: &base, StartAt: &base}
	_, nextDue, ok = nextOccurrence(todo)
	if !ok || nextDue == nil || *nextDue != "2026-11-19T09:00:00Z" {
		t.Fatalf("daily x3 应 +3 天: %v %v", ok, nextDue)
	}

	todo = Todo{RecType: "monthly", RecInterval: 1, DueAt: &base}
	_, nextDue, _ = nextOccurrence(todo)
	if nextDue == nil || *nextDue != "2026-12-16T09:00:00Z" {
		t.Fatalf("monthly 应 +1 月: %v", nextDue)
	}

	todo = Todo{RecType: "custom", RecInterval: 5, DueAt: &base}
	_, nextDue, _ = nextOccurrence(todo)
	if nextDue == nil || *nextDue != "2026-11-21T09:00:00Z" {
		t.Fatalf("custom x5 应 +5 天: %v", nextDue)
	}

	// 毫秒精度 ISO（前端 toISOString 输出）也要能解析
	ms := "2026-11-16T09:00:00.123Z"
	todo = Todo{RecType: "weekly", RecInterval: 1, DueAt: &ms}
	_, nextDue, ok = nextOccurrence(todo)
	if !ok || nextDue == nil || *nextDue != "2026-11-23T09:00:00Z" {
		t.Fatalf("毫秒精度应可解析推进: ok=%v due=%v", ok, nextDue)
	}

	// 无日期不生成
	todo = Todo{RecType: "daily", RecInterval: 1}
	if _, _, ok := nextOccurrence(todo); ok {
		t.Fatal("无 due/start 不应生成下一期")
	}
}

// 完成/关闭生成下一期（含标签复制）；重开不生成
func TestRecurrenceOnComplete(t *testing.T) {
	_, r := newTodoTestEnv(t)
	due := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)

	w := doJSON(t, r, http.MethodPost, "/api/todos", map[string]any{
		"title": "weekly-report", "rec_type": "weekly", "due_at": due, "tags": []string{"work"},
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}

	w = doJSON(t, r, http.MethodPost, "/api/todos/1/status", map[string]any{"status": "done"})
	if w.Code != http.StatusOK {
		t.Fatalf("done: %d %s", w.Code, w.Body.String())
	}

	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	var listResp struct {
		Code int   `json:"code"`
		Data []Todo `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	opens := 0
	var next *Todo
	for i := range listResp.Data {
		if listResp.Data[i].Status == "open" {
			opens++
			next = &listResp.Data[i]
		}
	}
	if opens != 1 || next == nil {
		t.Fatalf("完成后应有且仅有一条新一期 open：opens=%d", opens)
	}
	if next.RecType != "weekly" || len(next.Tags) != 1 || next.Tags[0] != "work" {
		t.Fatalf("新一期应继承规则与标签: %+v", next)
	}
	d1, _ := time.Parse(time.RFC3339, due)
	d2, err := time.Parse(time.RFC3339, *next.DueAt)
	if err != nil || d2.Sub(d1) != 7*24*time.Hour {
		t.Fatalf("新一期应错开 7 天: %v (%v)", next.DueAt, err)
	}

	// 重开不生成
	w = doJSON(t, r, http.MethodPost, "/api/todos/1/status", map[string]any{"status": "open"})
	if w.Code != http.StatusOK {
		t.Fatalf("reopen: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 2 {
		t.Fatalf("重开不应新增待办: %d", len(listResp.Data))
	}
}

// 子任务带规则不生成；软删→回收站→恢复→彻底删除 全链路
func TestTrashFlow(t *testing.T) {
	_, r := newTodoTestEnv(t)

	// 父 + 子任务
	w := doJSON(t, r, http.MethodPost, "/api/todos", map[string]any{"title": "parent", "rec_type": "daily", "due_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	if w.Code != http.StatusCreated {
		t.Fatalf("create parent: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodPost, "/api/todos", map[string]any{"title": "child", "parent_id": 1, "rec_type": "daily", "due_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)})
	if w.Code != http.StatusCreated {
		t.Fatalf("create child: %d", w.Code)
	}

	// 关闭子任务：子任务不生成下一期
	w = doJSON(t, r, http.MethodPost, "/api/todos/2/status", map[string]any{"status": "closed"})
	if w.Code != http.StatusOK {
		t.Fatalf("close child: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	var listResp struct {
		Data []Todo `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 2 {
		t.Fatalf("子任务不应生成下一期（应为父+子 2 条）: %d", len(listResp.Data))
	}

	// 删除父 → 两条都进回收站
	w = doJSON(t, r, http.MethodDelete, "/api/todos/1", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("delete parent: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 0 {
		t.Fatalf("软删后主列表应为空: %d", len(listResp.Data))
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos/trash", nil)
	var trashResp struct {
		Data []Todo `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &trashResp)
	if len(trashResp.Data) != 1 || trashResp.Data[0].ID != 1 || trashResp.Data[0].SubTotal != 1 {
		t.Fatalf("回收站应只有父待办（含子任务统计）: %+v", trashResp.Data)
	}

	// 恢复父 → 整棵还原
	w = doJSON(t, r, http.MethodPost, "/api/todos/1/restore", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("restore: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 2 {
		t.Fatalf("恢复后应为父+子 2 条: %d", len(listResp.Data))
	}

	// 彻底删除父 → 子任务/评论级联消失
	w = doJSON(t, r, http.MethodPost, "/api/todos/1/purge", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("purge: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	if len(listResp.Data) != 0 {
		t.Fatalf("purge 父后子任务应级联删除: %d", len(listResp.Data))
	}
}

// 批量操作与手动排序
func TestBatchAndSort(t *testing.T) {
	_, r := newTodoTestEnv(t)
	for _, title := range []string{"a", "b", "c"} {
		w := doJSON(t, r, http.MethodPost, "/api/todos", map[string]any{"title": title})
		if w.Code != http.StatusCreated {
			t.Fatalf("create %s: %d", title, w.Code)
		}
	}

	// 批量完成 2 条
	w := doJSON(t, r, http.MethodPost, "/api/todos/batch", map[string]any{"ids": []int64{1, 2}, "op": "done"})
	if w.Code != http.StatusOK {
		t.Fatalf("batch done: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	var listResp struct {
		Data []Todo `json:"data"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	doneCount := 0
	for _, td := range listResp.Data {
		if td.Status == "done" {
			doneCount++
		}
	}
	if doneCount != 2 {
		t.Fatalf("批量完成应有 2 条 done: %d", doneCount)
	}

	// 手动排序：把 3 排最前
	w = doJSON(t, r, http.MethodPost, "/api/todos/sort", map[string]any{"ids": []int64{3, 1, 2}})
	if w.Code != http.StatusOK {
		t.Fatalf("sort: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	var sortByID = map[int64]int{}
	for _, td := range listResp.Data {
		sortByID[td.ID] = td.Sort
	}
	if !(sortByID[3] < sortByID[1] && sortByID[1] < sortByID[2]) {
		t.Fatalf("sort 值应保持 3,1,2 顺序: %v", sortByID)
	}

	// 批量删标签 + 批量移动分类 + 批量软删
	w = doJSON(t, r, http.MethodPost, "/api/todos/batch", map[string]any{"ids": []int64{1, 2, 3}, "op": "tags_add", "tags": []string{"x", "y"}})
	if w.Code != http.StatusOK {
		t.Fatalf("batch tags_add: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodPost, "/api/todos/batch", map[string]any{"ids": []int64{2}, "op": "tags_remove", "tags": []string{"x"}})
	if w.Code != http.StatusOK {
		t.Fatalf("batch tags_remove: %d", w.Code)
	}
	w = doJSON(t, r, http.MethodGet, "/api/todos", nil)
	_ = json.Unmarshal(w.Body.Bytes(), &listResp)
	for _, td := range listResp.Data {
		if td.ID == 2 && (len(td.Tags) != 1 || td.Tags[0] != "y") {
			t.Fatalf("id=2 移除 x 后应只剩 y: %+v", td.Tags)
		}
	}
}
