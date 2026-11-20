// 待办模块接口：待办 CRUD（分类/子任务/标签/时间/超时提示配置）、状态流转、评论、
// 回收站（软删/恢复/彻底删除）、批量操作、手动排序、重复任务（完成后生成下一期）。
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Todo 待办主体。Tags 为标签名；SubTotal/SubDone 为直接子任务统计（列表一次带出）。
// WarnOffsets 为多档提前提醒（分钟）；为空时退化使用 WarnMinutes 单档。
// RecType 重复规则：'' 不重复 / daily 每天 / weekly 每周 / monthly 每月 / custom 每 N 天；
// 仅顶层待办生效，完成或关闭后自动按规则生成下一期。
type Todo struct {
	ID          int64    `json:"id"`
	CategoryID  *int64   `json:"category_id"`
	ParentID    *int64   `json:"parent_id"`
	Title       string   `json:"title"`
	Subtitle    string   `json:"subtitle"`
	Description string   `json:"description"`
	Priority    int      `json:"priority"`
	Status      string   `json:"status"`
	StartAt     *string  `json:"start_at"`
	DueAt       *string  `json:"due_at"`
	WarnMinutes *int     `json:"warn_minutes"`
	WarnOffsets []int    `json:"warn_offsets"`
	RecType     string   `json:"rec_type"`
	RecInterval int      `json:"rec_interval"`
	Sort        int      `json:"sort"`
	CompletedAt *string  `json:"completed_at"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
	DeletedAt   *string  `json:"deleted_at"`
	Tags        []string `json:"tags"`
	SubTotal    int      `json:"sub_total"`
	SubDone     int      `json:"sub_done"`
}

type TodoCategory struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Sort      int    `json:"sort"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	Count     int    `json:"count"`
}

type TodoTag struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type TodoComment struct {
	ID        int64  `json:"id"`
	TodoID    int64  `json:"todo_id"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type TodoHandler struct {
	db *sql.DB
}

func NewTodoHandler(db *sql.DB) *TodoHandler { return &TodoHandler{db: db} }

const todoCols = "id, category_id, parent_id, title, subtitle, description, priority, status, start_at, due_at, warn_minutes, warn_offsets, rec_type, rec_interval, sort, completed_at, created_at, updated_at, deleted_at"

// scanTodo 把一行 todos 记录扫进 Todo（warn_offsets/deleted_at 存 TEXT，判空转换）。
func scanTodo(scan func(dest ...any) error) (Todo, error) {
	var t Todo
	t.Tags = []string{}
	var warnOffsets, deletedAt sql.NullString
	if err := scan(&t.ID, &t.CategoryID, &t.ParentID, &t.Title, &t.Subtitle, &t.Description,
		&t.Priority, &t.Status, &t.StartAt, &t.DueAt, &t.WarnMinutes, &warnOffsets,
		&t.RecType, &t.RecInterval, &t.Sort, &t.CompletedAt, &t.CreatedAt, &t.UpdatedAt, &deletedAt); err != nil {
		return t, err
	}
	t.WarnOffsets = parseOffsets(warnOffsets)
	if deletedAt.Valid {
		t.DeletedAt = &deletedAt.String
	}
	return t, nil
}

func parseOffsets(ns sql.NullString) []int {
	if !ns.Valid || ns.String == "" {
		return []int{}
	}
	var out []int
	if err := json.Unmarshal([]byte(ns.String), &out); err != nil {
		return []int{}
	}
	return out
}

func offsetsJSON(offsets []int) any {
	if len(offsets) == 0 {
		return nil
	}
	b, err := json.Marshal(offsets)
	if err != nil {
		return nil
	}
	return string(b)
}

// normalizeOffsets 去重/去负/截断（最多 8 档），并升序排列。
func normalizeOffsets(in []int) []int {
	seen := map[int]bool{}
	out := make([]int, 0, len(in))
	for _, v := range in {
		if v < 0 || v > 60*24*30 || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	sort.Ints(out)
	if len(out) > 8 {
		out = out[:8]
	}
	return out
}

var recTypes = map[string]bool{"": true, "daily": true, "weekly": true, "monthly": true, "custom": true}

// List GET /api/todos —— 平铺返回全部未删除待办（含标签名与子任务统计），前端组树并筛选。
func (h *TodoHandler) List(c *gin.Context) {
	rows, err := h.db.Query("SELECT " + todoCols + " FROM todos WHERE deleted_at IS NULL ORDER BY sort, id")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询待办失败")
		return
	}
	defer rows.Close()

	list := make([]Todo, 0)
	for rows.Next() {
		t, err := scanTodo(rows.Scan)
		if err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取待办失败")
			return
		}
		list = append(list, t)
	}
	h.enrich(list, false)
	respondOK(c, http.StatusOK, list)
}

// enrich 批量补标签名与子任务统计。回收站语境 includeDeletedChildren = true：
// 已软删的子任务随父级展示并计入统计（恢复时整棵还原）。
func (h *TodoHandler) enrich(list []Todo, includeDeletedChildren bool) {
	byID := make(map[int64]int, len(list))
	for i := range list {
		byID[list[i].ID] = i
	}

	tagRows, err := h.db.Query(`
		SELECT ttt.todo_id, tt.name FROM todo_todo_tag ttt
		JOIN todo_tags tt ON tt.id = ttt.tag_id ORDER BY tt.name`)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var todoID int64
			var name string
			if tagRows.Scan(&todoID, &name) == nil {
				if i, ok := byID[todoID]; ok {
					list[i].Tags = append(list[i].Tags, name)
				}
			}
		}
	}

	subQuery := `
		SELECT parent_id, COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)
		FROM todos WHERE parent_id IS NOT NULL`
	if !includeDeletedChildren {
		subQuery += " AND deleted_at IS NULL"
	}
	subQuery += " GROUP BY parent_id"
	subRows, err := h.db.Query(subQuery)
	if err == nil {
		defer subRows.Close()
		for subRows.Next() {
			var pid int64
			var total, done int
			if subRows.Scan(&pid, &total, &done) == nil {
				if i, ok := byID[pid]; ok {
					list[i].SubTotal = total
					list[i].SubDone = done
				}
			}
		}
	}
}

// Create POST /api/todos
func (h *TodoHandler) Create(c *gin.Context) {
	var p struct {
		Title       string   `json:"title"`
		Subtitle    string   `json:"subtitle"`
		Description string   `json:"description"`
		CategoryID  *int64   `json:"category_id"`
		ParentID    *int64   `json:"parent_id"`
		Priority    *int     `json:"priority"`
		StartAt     *string  `json:"start_at"`
		DueAt       *string  `json:"due_at"`
		WarnMinutes *int     `json:"warn_minutes"`
		WarnOffsets []int    `json:"warn_offsets"`
		RecType     string   `json:"rec_type"`
		RecInterval *int     `json:"rec_interval"`
		Tags        []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	p.Title = strings.TrimSpace(p.Title)
	if p.Title == "" {
		respondError(c, http.StatusBadRequest, 400, "标题不能为空")
		return
	}
	if !recTypes[p.RecType] {
		respondError(c, http.StatusBadRequest, 400, "无效的重复类型")
		return
	}
	priority := 4
	if p.Priority != nil {
		if *p.Priority < 0 || *p.Priority > 6 {
			respondError(c, http.StatusBadRequest, 400, "优先级须在 P0 - P6")
			return
		}
		priority = *p.Priority
	}
	if p.CategoryID != nil && !h.categoryExists(*p.CategoryID) {
		respondError(c, http.StatusBadRequest, 400, "分类不存在")
		return
	}
	// 子任务只允许一级：父待办不能再是子任务；重复规则仅顶层待办有效
	if p.ParentID != nil {
		if !h.exists(*p.ParentID) {
			respondError(c, http.StatusBadRequest, 400, "父待办不存在")
			return
		}
		var parentParent sql.NullInt64
		_ = h.db.QueryRow("SELECT parent_id FROM todos WHERE id = ?", *p.ParentID).Scan(&parentParent)
		if parentParent.Valid {
			respondError(c, http.StatusBadRequest, 400, "子任务下不能再拆分子任务")
			return
		}
		p.RecType = ""
	}

	now := nowRFC()
	res, err := h.db.Exec(
		`INSERT INTO todos (category_id, parent_id, title, subtitle, description, priority, status,
			start_at, due_at, warn_minutes, warn_offsets, rec_type, rec_interval, sort, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		p.CategoryID, p.ParentID, p.Title, strings.TrimSpace(p.Subtitle), p.Description,
		priority, p.StartAt, p.DueAt, p.WarnMinutes, offsetsJSON(normalizeOffsets(p.WarnOffsets)),
		p.RecType, clampInterval(p.RecType, p.RecInterval), now, now)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "创建待办失败")
		return
	}
	id, _ := res.LastInsertId()
	h.replaceTags(id, p.Tags)
	h.getOne(c, id, http.StatusCreated)
}

// Update PUT /api/todos/:id —— 全量可编辑字段的局部更新
func (h *TodoHandler) Update(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var p struct {
		Title       *string   `json:"title"`
		Subtitle    *string   `json:"subtitle"`
		Description *string   `json:"description"`
		CategoryID  *int64    `json:"category_id"`
		Priority    *int      `json:"priority"`
		StartAt     **string  `json:"start_at"`
		DueAt       **string  `json:"due_at"`
		WarnMinutes **int     `json:"warn_minutes"`
		WarnOffsets *[]int    `json:"warn_offsets"`
		RecType     *string   `json:"rec_type"`
		RecInterval *int      `json:"rec_interval"`
		Tags        *[]string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}

	cur, ok := h.loadTodo(id)
	if !ok {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}

	title, subtitle, description := cur.Title, cur.Subtitle, cur.Description
	if p.Title != nil {
		title = strings.TrimSpace(*p.Title)
		if title == "" {
			respondError(c, http.StatusBadRequest, 400, "标题不能为空")
			return
		}
	}
	if p.Subtitle != nil {
		subtitle = strings.TrimSpace(*p.Subtitle)
	}
	if p.Description != nil {
		description = *p.Description
	}
	priority := cur.Priority
	if p.Priority != nil {
		if *p.Priority < 0 || *p.Priority > 6 {
			respondError(c, http.StatusBadRequest, 400, "优先级须在 P0 - P6")
			return
		}
		priority = *p.Priority
	}
	categoryID := cur.CategoryID
	if p.CategoryID != nil {
		if *p.CategoryID == 0 {
			categoryID = nil
		} else if !h.categoryExists(*p.CategoryID) {
			respondError(c, http.StatusBadRequest, 400, "分类不存在")
			return
		}
	}
	startAt, dueAt := cur.StartAt, cur.DueAt
	if p.StartAt != nil {
		startAt = *p.StartAt
	}
	if p.DueAt != nil {
		dueAt = *p.DueAt
	}
	warnMinutes := cur.WarnMinutes
	if p.WarnMinutes != nil {
		warnMinutes = *p.WarnMinutes
	}
	warnOffsets := cur.WarnOffsets
	if p.WarnOffsets != nil {
		warnOffsets = normalizeOffsets(*p.WarnOffsets)
	}
	recType, recInterval := cur.RecType, cur.RecInterval
	if p.RecType != nil {
		if !recTypes[*p.RecType] {
			respondError(c, http.StatusBadRequest, 400, "无效的重复类型")
			return
		}
		recType = *p.RecType
	}
	if p.RecInterval != nil {
		recInterval = clampInterval(recType, p.RecInterval)
	}

	if _, err := h.db.Exec(
		`UPDATE todos SET category_id = ?, title = ?, subtitle = ?, description = ?, priority = ?,
		 start_at = ?, due_at = ?, warn_minutes = ?, warn_offsets = ?, rec_type = ?, rec_interval = ?,
		 updated_at = ? WHERE id = ?`,
		categoryID, title, subtitle, description, priority, startAt, dueAt, warnMinutes,
		offsetsJSON(warnOffsets), recType, recInterval, nowRFC(), id); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "保存待办失败")
		return
	}
	if p.Tags != nil {
		h.replaceTags(id, *p.Tags)
	}
	h.getOne(c, id, http.StatusOK)
}

// SetStatus POST /api/todos/:id/status {status: open|done|closed}
// 完成或关闭带重复规则的顶层待办时，自动按规则生成下一期（属性/标签/提醒配置原样继承）。
func (h *TodoHandler) SetStatus(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var p struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&p); err != nil || (p.Status != "open" && p.Status != "done" && p.Status != "closed") {
		respondError(c, http.StatusBadRequest, 400, "无效的状态")
		return
	}
	cur, ok := h.loadTodo(id)
	if !ok {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	var completedAt any
	if p.Status == "done" {
		completedAt = nowRFC()
	}
	if _, err := h.db.Exec("UPDATE todos SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
		p.Status, completedAt, nowRFC(), id); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "更新状态失败")
		return
	}
	if p.Status != "open" {
		h.generateNext(cur)
	}
	h.getOne(c, id, http.StatusOK)
}

// clampInterval 重复步长收敛到 1-365；无规则时固定为 1。
func clampInterval(recType string, interval *int) int {
	if recType == "" {
		return 1
	}
	n := 1
	if interval != nil {
		n = *interval
	}
	if n < 1 {
		n = 1
	}
	if n > 365 {
		n = 365
	}
	return n
}

// nextOccurrence 按重复规则把时间轴推到下一期；无 due_at 与 start_at 时不生成。
// 锚点取原时间轴（而非完成时刻），保证排期稳定；Go 的 AddDate 月末溢出会顺延到下月初。
func nextOccurrence(t Todo) (nextStart, nextDue *string, ok bool) {
	if t.RecType == "" {
		return nil, nil, false
	}
	n := t.RecInterval
	if n < 1 {
		n = 1
	}
	shift := func(iso *string) (*string, bool) {
		if iso == nil {
			return nil, true
		}
		d, err := time.Parse(time.RFC3339, *iso)
		if err != nil {
			return nil, false
		}
		switch t.RecType {
		case "weekly":
			d = d.AddDate(0, 0, 7*n)
		case "monthly":
			d = d.AddDate(0, n, 0)
		default: // daily / custom 都按天步进
			d = d.AddDate(0, 0, n)
		}
		out := d.Format(time.RFC3339)
		return &out, true
	}
	var valid bool
	if nextStart, valid = shift(t.StartAt); !valid {
		return nil, nil, false
	}
	if nextDue, valid = shift(t.DueAt); !valid {
		return nil, nil, false
	}
	if nextStart == nil && nextDue == nil {
		return nil, nil, false
	}
	return nextStart, nextDue, true
}

// generateNext 生成下一期重复待办（仅顶层带规则的待办）；失败静默，不阻断状态变更。
func (h *TodoHandler) generateNext(cur Todo) {
	if cur.ParentID != nil {
		return
	}
	nextStart, nextDue, ok := nextOccurrence(cur)
	if !ok {
		return
	}
	now := nowRFC()
	res, err := h.db.Exec(
		`INSERT INTO todos (category_id, parent_id, title, subtitle, description, priority, status,
			start_at, due_at, warn_minutes, warn_offsets, rec_type, rec_interval, sort, created_at, updated_at)
		 VALUES (?, NULL, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		cur.CategoryID, cur.Title, cur.Subtitle, cur.Description, cur.Priority,
		nextStart, nextDue, cur.WarnMinutes, offsetsJSON(cur.WarnOffsets),
		cur.RecType, cur.RecInterval, now, now)
	if err != nil {
		return
	}
	nextID, _ := res.LastInsertId()
	// 复制标签关联
	_, _ = h.db.Exec(`INSERT OR IGNORE INTO todo_todo_tag (todo_id, tag_id)
		SELECT ?, tag_id FROM todo_todo_tag WHERE todo_id = ?`, nextID, cur.ID)
}

// Delete DELETE /api/todos/:id —— 移入回收站（软删）：顶层连同子任务整棵标记；
// 评论/标签关联保留，恢复即还原，30 天后由启动清理彻底删除。
func (h *TodoHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	if !h.softDelete(id) {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// softDelete 软删一条待办；顶层待办连同子任务整棵标记。返回是否命中有效行。
func (h *TodoHandler) softDelete(id int64) bool {
	var parent sql.NullInt64
	err := h.db.QueryRow("SELECT parent_id FROM todos WHERE id = ? AND deleted_at IS NULL", id).Scan(&parent)
	if err != nil {
		return false
	}
	now := nowRFC()
	var res sql.Result
	if !parent.Valid {
		res, err = h.db.Exec("UPDATE todos SET deleted_at = ?, updated_at = ? WHERE id = ? OR parent_id = ?", now, now, id, id)
	} else {
		res, err = h.db.Exec("UPDATE todos SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, id)
	}
	if err != nil {
		return false
	}
	affected, _ := res.RowsAffected()
	return affected > 0
}

// ListTrash GET /api/todos/trash —— 回收站：被删除的顶层待办 + 父级仍在的已删子任务。
func (h *TodoHandler) ListTrash(c *gin.Context) {
	rows, err := h.db.Query("SELECT "+todoCols+" FROM todos WHERE deleted_at IS NOT NULL AND "+
		"(parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM todos p WHERE p.id = todos.parent_id AND p.deleted_at IS NOT NULL)) "+
		"ORDER BY deleted_at DESC, id DESC")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询回收站失败")
		return
	}
	defer rows.Close()
	list := make([]Todo, 0)
	for rows.Next() {
		t, err := scanTodo(rows.Scan)
		if err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取回收站失败")
			return
		}
		list = append(list, t)
	}
	h.enrich(list, true)
	respondOK(c, http.StatusOK, list)
}

// Restore POST /api/todos/:id/restore —— 从回收站恢复（顶层连同子任务整棵还原）。
func (h *TodoHandler) Restore(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var parent sql.NullInt64
	err := h.db.QueryRow("SELECT parent_id FROM todos WHERE id = ? AND deleted_at IS NOT NULL", id).Scan(&parent)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "回收站中不存在该待办")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询待办失败")
		return
	}
	now := nowRFC()
	var res sql.Result
	if !parent.Valid {
		res, err = h.db.Exec("UPDATE todos SET deleted_at = NULL, updated_at = ? WHERE id = ? OR parent_id = ?", now, id, id)
	} else {
		res, err = h.db.Exec("UPDATE todos SET deleted_at = NULL, updated_at = ? WHERE id = ?", now, id)
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "恢复待办失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "回收站中不存在该待办")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// Purge POST /api/todos/:id/purge —— 彻底删除（不可恢复），子任务/评论/标签关联随外键级联。
func (h *TodoHandler) Purge(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	res, err := h.db.Exec("DELETE FROM todos WHERE id = ?", id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "彻底删除失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "回收站中不存在该待办")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// Batch POST /api/todos/batch —— 批量操作 {ids, op, category_id?, tags?}
// op ∈ done | open | closed | category | tags_add | tags_remove | delete；跳过不存在或已删除的 ID。
func (h *TodoHandler) Batch(c *gin.Context) {
	var p struct {
		IDs        []int64  `json:"ids"`
		Op         string   `json:"op"`
		CategoryID *int64   `json:"category_id"`
		Tags       []string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	if len(p.IDs) == 0 {
		respondError(c, http.StatusBadRequest, 400, "缺少待办 ID")
		return
	}
	now := nowRFC()
	switch p.Op {
	case "done", "open", "closed":
		for _, id := range p.IDs {
			cur, ok := h.loadTodo(id)
			if !ok {
				continue
			}
			var completedAt any
			if p.Op == "done" {
				completedAt = now
			}
			if _, err := h.db.Exec("UPDATE todos SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
				p.Op, completedAt, now, id); err != nil {
				continue
			}
			if p.Op != "open" {
				h.generateNext(cur)
			}
		}
	case "category":
		var catID any
		if p.CategoryID != nil && *p.CategoryID != 0 {
			if !h.categoryExists(*p.CategoryID) {
				respondError(c, http.StatusBadRequest, 400, "分类不存在")
				return
			}
			catID = *p.CategoryID
		}
		for _, id := range p.IDs {
			_, _ = h.db.Exec("UPDATE todos SET category_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", catID, now, id)
		}
	case "tags_add", "tags_remove":
		for _, id := range p.IDs {
			if !h.exists(id) {
				continue
			}
			next := h.tagNamesOf(id)
			if p.Op == "tags_add" {
				next = append(next, p.Tags...)
			} else {
				drop := map[string]bool{}
				for _, name := range p.Tags {
					drop[name] = true
				}
				kept := next[:0]
				for _, name := range next {
					if !drop[name] {
						kept = append(kept, name)
					}
				}
				next = kept
			}
			h.replaceTags(id, next)
		}
	case "delete":
		for _, id := range p.IDs {
			h.softDelete(id)
		}
	default:
		respondError(c, http.StatusBadRequest, 400, "无效的批量操作")
		return
	}
	respondOK(c, http.StatusOK, gin.H{"requested": len(p.IDs)})
}

// Sort POST /api/todos/sort —— 手动排序：按传入顺序写 sort 值（拖拽 / 上移下移后调用）。
func (h *TodoHandler) Sort(c *gin.Context) {
	var p struct {
		IDs []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&p); err != nil || len(p.IDs) == 0 {
		respondError(c, http.StatusBadRequest, 400, "缺少排序 ID")
		return
	}
	now := nowRFC()
	for i, id := range p.IDs {
		_, _ = h.db.Exec("UPDATE todos SET sort = ?, updated_at = ? WHERE id = ?", i, now, id)
	}
	respondOK(c, http.StatusOK, nil)
}

// ---- 评论 ----

// ListComments GET /api/todos/:id/comments
func (h *TodoHandler) ListComments(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	rows, err := h.db.Query(
		"SELECT id, todo_id, content, created_at FROM todo_comments WHERE todo_id = ? ORDER BY id", id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询评论失败")
		return
	}
	defer rows.Close()
	list := make([]TodoComment, 0)
	for rows.Next() {
		var cm TodoComment
		if err := rows.Scan(&cm.ID, &cm.TodoID, &cm.Content, &cm.CreatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取评论失败")
			return
		}
		list = append(list, cm)
	}
	respondOK(c, http.StatusOK, list)
}

// CreateComment POST /api/todos/:id/comments {content}
func (h *TodoHandler) CreateComment(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var p struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&p); err != nil || strings.TrimSpace(p.Content) == "" {
		respondError(c, http.StatusBadRequest, 400, "评论内容不能为空")
		return
	}
	if !h.exists(id) {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	now := nowRFC()
	res, err := h.db.Exec(
		"INSERT INTO todo_comments (todo_id, content, created_at) VALUES (?, ?, ?)",
		id, strings.TrimSpace(p.Content), now)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "添加评论失败")
		return
	}
	cid, _ := res.LastInsertId()
	respondOK(c, http.StatusCreated, TodoComment{ID: cid, TodoID: id, Content: strings.TrimSpace(p.Content), CreatedAt: now})
}

// DeleteComment DELETE /api/todos/:id/comments/:cid
func (h *TodoHandler) DeleteComment(c *gin.Context) {
	cid, err := strconv.ParseInt(c.Param("cid"), 10, 64)
	if err != nil || cid <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的评论 ID")
		return
	}
	if _, err := h.db.Exec("DELETE FROM todo_comments WHERE id = ?", cid); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "删除评论失败")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// ---- 分类 ----

// ListCategories GET /api/todo-categories（含各分类待办数量，不含回收站中的）
func (h *TodoHandler) ListCategories(c *gin.Context) {
	rows, err := h.db.Query("SELECT id, name, sort, created_at, updated_at FROM todo_categories ORDER BY sort, id")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询分类失败")
		return
	}
	defer rows.Close()
	list := make([]TodoCategory, 0)
	for rows.Next() {
		var cat TodoCategory
		if err := rows.Scan(&cat.ID, &cat.Name, &cat.Sort, &cat.CreatedAt, &cat.UpdatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取分类失败")
			return
		}
		list = append(list, cat)
	}
	for i := range list {
		// 只统计顶层待办（子任务随父级展示，不计入分类数量）
		_ = h.db.QueryRow(
			"SELECT COUNT(*) FROM todos WHERE category_id = ? AND parent_id IS NULL AND deleted_at IS NULL",
			list[i].ID).Scan(&list[i].Count)
	}
	respondOK(c, http.StatusOK, list)
}

// CreateCategory POST /api/todo-categories {name}
func (h *TodoHandler) CreateCategory(c *gin.Context) {
	var p struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		respondError(c, http.StatusBadRequest, 400, "名称不能为空")
		return
	}
	if h.categoryNameExists(name, 0) {
		respondError(c, http.StatusConflict, 409, "已存在同名分类")
		return
	}
	now := nowRFC()
	res, err := h.db.Exec(
		"INSERT INTO todo_categories (name, sort, created_at, updated_at) VALUES (?, 0, ?, ?)", name, now, now)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "创建分类失败")
		return
	}
	id, _ := res.LastInsertId()
	respondOK(c, http.StatusCreated, TodoCategory{ID: id, Name: name, CreatedAt: now, UpdatedAt: now})
}

// UpdateCategory PUT /api/todo-categories/:id {name}
func (h *TodoHandler) UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的分类 ID")
		return
	}
	var p struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	name := strings.TrimSpace(p.Name)
	if name == "" {
		respondError(c, http.StatusBadRequest, 400, "名称不能为空")
		return
	}
	if h.categoryNameExists(name, id) {
		respondError(c, http.StatusConflict, 409, "已存在同名分类")
		return
	}
	res, err := h.db.Exec("UPDATE todo_categories SET name = ?, updated_at = ? WHERE id = ?", name, nowRFC(), id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "重命名失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "分类不存在")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// DeleteCategory DELETE /api/todo-categories/:id —— 分类下待办回到根（category_id 置空）
func (h *TodoHandler) DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的分类 ID")
		return
	}
	if _, err := h.db.Exec("DELETE FROM todo_categories WHERE id = ?", id); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "删除分类失败")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// ---- 标签 ----

// ListTags GET /api/todo-tags（含有效待办的使用数量，按数量降序）
func (h *TodoHandler) ListTags(c *gin.Context) {
	rows, err := h.db.Query(`
		SELECT tt.id, tt.name,
			(SELECT COUNT(*) FROM todo_todo_tag ttt JOIN todos t ON t.id = ttt.todo_id
			 WHERE ttt.tag_id = tt.id AND t.deleted_at IS NULL) AS cnt
		FROM todo_tags tt ORDER BY cnt DESC, tt.name`)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询标签失败")
		return
	}
	defer rows.Close()
	list := make([]TodoTag, 0)
	for rows.Next() {
		var t TodoTag
		if err := rows.Scan(&t.ID, &t.Name, &t.Count); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取标签失败")
			return
		}
		list = append(list, t)
	}
	respondOK(c, http.StatusOK, list)
}

// ---- 内部工具 ----

// loadTodo 读取单条未删除的待办；不存在或已在回收站返回 false。
func (h *TodoHandler) loadTodo(id int64) (Todo, bool) {
	row := h.db.QueryRow("SELECT "+todoCols+" FROM todos WHERE id = ? AND deleted_at IS NULL", id)
	t, err := scanTodo(row.Scan)
	return t, err == nil
}

func (h *TodoHandler) getOne(c *gin.Context, id int64, status int) {
	t, ok := h.loadTodo(id)
	if !ok {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	tagRows, err := h.db.Query(`
		SELECT tt.name FROM todo_todo_tag ttt JOIN todo_tags tt ON tt.id = ttt.tag_id
		WHERE ttt.todo_id = ? ORDER BY tt.name`, id)
	if err == nil {
		defer tagRows.Close()
		for tagRows.Next() {
			var name string
			if tagRows.Scan(&name) == nil {
				t.Tags = append(t.Tags, name)
			}
		}
	}
	_ = h.db.QueryRow(`
		SELECT COUNT(*), IFNULL(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0)
		FROM todos WHERE parent_id = ? AND deleted_at IS NULL`, id).Scan(&t.SubTotal, &t.SubDone)
	respondOK(c, status, t)
}

func (h *TodoHandler) parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的待办 ID")
		return 0, false
	}
	return id, true
}

func (h *TodoHandler) exists(id int64) bool {
	var one int
	return h.db.QueryRow("SELECT 1 FROM todos WHERE id = ? AND deleted_at IS NULL", id).Scan(&one) == nil
}

func (h *TodoHandler) categoryExists(id int64) bool {
	var one int
	return h.db.QueryRow("SELECT 1 FROM todo_categories WHERE id = ?", id).Scan(&one) == nil
}

func (h *TodoHandler) categoryNameExists(name string, excludeID int64) bool {
	var one int
	return h.db.QueryRow(
		"SELECT 1 FROM todo_categories WHERE name = ? AND id <> ?", name, excludeID).Scan(&one) == nil
}

// tagNamesOf 读回待办当前的标签名列表（批量加/删标签时在其基础上增减）。
func (h *TodoHandler) tagNamesOf(todoID int64) []string {
	rows, err := h.db.Query(`
		SELECT tt.name FROM todo_todo_tag ttt JOIN todo_tags tt ON tt.id = ttt.tag_id
		WHERE ttt.todo_id = ? ORDER BY tt.name`, todoID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	names := make([]string, 0, 4)
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			names = append(names, name)
		}
	}
	return names
}

// replaceTags 以传入标签名全量替换待办的标签（自动建缺失的标签行）
func (h *TodoHandler) replaceTags(todoID int64, names []string) {
	if _, err := h.db.Exec("DELETE FROM todo_todo_tag WHERE todo_id = ?", todoID); err != nil {
		return
	}
	seen := map[string]bool{}
	for _, raw := range names {
		name := strings.TrimSpace(raw)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		if len(name) > 24 {
			name = name[:24]
		}
		if _, err := h.db.Exec("INSERT OR IGNORE INTO todo_tags (name, created_at) VALUES (?, ?)", name, nowRFC()); err != nil {
			continue
		}
		var tagID int64
		if err := h.db.QueryRow("SELECT id FROM todo_tags WHERE name = ?", name).Scan(&tagID); err != nil {
			continue
		}
		_, _ = h.db.Exec("INSERT OR IGNORE INTO todo_todo_tag (todo_id, tag_id) VALUES (?, ?)", todoID, tagID)
	}
	// 清理没有任何待办引用的孤儿标签（回收站中的引用不计入）
	_, _ = h.db.Exec(`DELETE FROM todo_tags WHERE id NOT IN (
		SELECT ttt.tag_id FROM todo_todo_tag ttt JOIN todos t ON t.id = ttt.todo_id WHERE t.deleted_at IS NULL)`)
}
