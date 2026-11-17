// 待办模块接口：待办 CRUD（分类/子任务/标签/时间/超时提示配置）、状态流转、评论。
package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Todo 待办主体。Tags 为标签名；SubTotal/SubDone 为直接子任务统计（列表一次带出）。
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
	Sort        int      `json:"sort"`
	CompletedAt *string  `json:"completed_at"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
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

const todoCols = "id, category_id, parent_id, title, subtitle, description, priority, status, start_at, due_at, warn_minutes, sort, completed_at, created_at, updated_at"

// List GET /api/todos —— 平铺返回全部待办（含标签名与子任务统计），前端组树并筛选。
func (h *TodoHandler) List(c *gin.Context) {
	rows, err := h.db.Query("SELECT " + todoCols + " FROM todos ORDER BY sort, id")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询待办失败")
		return
	}
	defer rows.Close()

	list := make([]Todo, 0)
	for rows.Next() {
		var t Todo
		t.Tags = []string{}
		if err := rows.Scan(&t.ID, &t.CategoryID, &t.ParentID, &t.Title, &t.Subtitle, &t.Description,
			&t.Priority, &t.Status, &t.StartAt, &t.DueAt, &t.WarnMinutes, &t.Sort, &t.CompletedAt,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取待办失败")
			return
		}
		list = append(list, t)
	}

	byID := make(map[int64]int, len(list))
	for i := range list {
		byID[list[i].ID] = i
	}

	// 批量补标签名
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

	// 子任务统计（直接子级）
	subRows, err := h.db.Query(`
		SELECT parent_id, COUNT(*), SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)
		FROM todos WHERE parent_id IS NOT NULL GROUP BY parent_id`)
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

	respondOK(c, http.StatusOK, list)
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
	// 子任务只允许一级：父待办不能再是子任务
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
	}

	now := nowRFC()
	res, err := h.db.Exec(
		`INSERT INTO todos (category_id, parent_id, title, subtitle, description, priority, status,
			start_at, due_at, warn_minutes, sort, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, 0, ?, ?)`,
		p.CategoryID, p.ParentID, p.Title, strings.TrimSpace(p.Subtitle), p.Description,
		priority, p.StartAt, p.DueAt, p.WarnMinutes, now, now)
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
		Title       *string  `json:"title"`
		Subtitle    *string  `json:"subtitle"`
		Description *string  `json:"description"`
		CategoryID  *int64   `json:"category_id"`
		Priority    *int     `json:"priority"`
		StartAt     **string `json:"start_at"`
		DueAt       **string `json:"due_at"`
		WarnMinutes **int    `json:"warn_minutes"`
		Tags        *[]string `json:"tags"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}

	var cur Todo
	err := h.db.QueryRow("SELECT "+todoCols+" FROM todos WHERE id = ?", id).Scan(
		&cur.ID, &cur.CategoryID, &cur.ParentID, &cur.Title, &cur.Subtitle, &cur.Description,
		&cur.Priority, &cur.Status, &cur.StartAt, &cur.DueAt, &cur.WarnMinutes, &cur.Sort,
		&cur.CompletedAt, &cur.CreatedAt, &cur.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询待办失败")
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

	if _, err := h.db.Exec(
		`UPDATE todos SET category_id = ?, title = ?, subtitle = ?, description = ?, priority = ?,
		 start_at = ?, due_at = ?, warn_minutes = ?, updated_at = ? WHERE id = ?`,
		categoryID, title, subtitle, description, priority, startAt, dueAt, warnMinutes, nowRFC(), id); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "保存待办失败")
		return
	}
	if p.Tags != nil {
		h.replaceTags(id, *p.Tags)
	}
	h.getOne(c, id, http.StatusOK)
}

// SetStatus POST /api/todos/:id/status {status: open|done|closed}
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
	var completedAt any
	if p.Status == "done" {
		completedAt = nowRFC()
	}
	res, err := h.db.Exec("UPDATE todos SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
		p.Status, completedAt, nowRFC(), id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "更新状态失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	h.getOne(c, id, http.StatusOK)
}

// Delete DELETE /api/todos/:id —— 子任务/评论/标签关联级联删除
func (h *TodoHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	res, err := h.db.Exec("DELETE FROM todos WHERE id = ?", id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "删除待办失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
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

// ListCategories GET /api/todo-categories（含各分类待办数量）
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
		_ = h.db.QueryRow("SELECT COUNT(*) FROM todos WHERE category_id = ? AND parent_id IS NULL", list[i].ID).Scan(&list[i].Count)
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

// ListTags GET /api/todo-tags（含使用数量，按数量降序）
func (h *TodoHandler) ListTags(c *gin.Context) {
	rows, err := h.db.Query(`
		SELECT tt.id, tt.name, COUNT(ttt.todo_id) FROM todo_tags tt
		LEFT JOIN todo_todo_tag ttt ON ttt.tag_id = tt.id
		GROUP BY tt.id ORDER BY COUNT(ttt.todo_id) DESC, tt.name`)
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

func (h *TodoHandler) getOne(c *gin.Context, id int64, status int) {
	var t Todo
	t.Tags = []string{}
	err := h.db.QueryRow("SELECT "+todoCols+" FROM todos WHERE id = ?", id).Scan(
		&t.ID, &t.CategoryID, &t.ParentID, &t.Title, &t.Subtitle, &t.Description,
		&t.Priority, &t.Status, &t.StartAt, &t.DueAt, &t.WarnMinutes, &t.Sort,
		&t.CompletedAt, &t.CreatedAt, &t.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "待办不存在")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询待办失败")
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
		FROM todos WHERE parent_id = ?`, id).Scan(&t.SubTotal, &t.SubDone)
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
	return h.db.QueryRow("SELECT 1 FROM todos WHERE id = ?", id).Scan(&one) == nil
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
	// 清理没有任何待办引用的孤儿标签
	_, _ = h.db.Exec("DELETE FROM todo_tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM todo_todo_tag)")
}
