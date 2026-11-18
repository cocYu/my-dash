// 笔记接口：列表/详情/增删改/拖拽排序；内容变化时自动存版本。
package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

type NoteMeta struct {
	ID        int64  `json:"id"`
	FolderID  *int64 `json:"folder_id"`
	Title     string `json:"title"`
	Sort      int    `json:"sort"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type NoteFull struct {
	NoteMeta
	Content string `json:"content"`
}

type NoteHandler struct {
	db *sql.DB
}

func NewNoteHandler(db *sql.DB) *NoteHandler { return &NoteHandler{db: db} }

// List GET /api/notes —— 元数据列表（不含正文）。
func (h *NoteHandler) List(c *gin.Context) {
	rows, err := h.db.Query("SELECT id, folder_id, title, sort, created_at, updated_at FROM notes ORDER BY sort, id")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
		return
	}
	defer rows.Close()

	list := make([]NoteMeta, 0)
	for rows.Next() {
		var n NoteMeta
		if err := rows.Scan(&n.ID, &n.FolderID, &n.Title, &n.Sort, &n.CreatedAt, &n.UpdatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取笔记失败")
			return
		}
		list = append(list, n)
	}
	respondOK(c, http.StatusOK, list)
}

// Get GET /api/notes/:id
func (h *NoteHandler) Get(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var n NoteFull
	err := h.db.QueryRow(
		"SELECT id, folder_id, title, content, sort, created_at, updated_at FROM notes WHERE id = ?", id,
	).Scan(&n.ID, &n.FolderID, &n.Title, &n.Content, &n.Sort, &n.CreatedAt, &n.UpdatedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
	case err != nil:
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
	default:
		respondOK(c, http.StatusOK, n)
	}
}

// Create POST /api/notes {title, folder_id?, content?}
func (h *NoteHandler) Create(c *gin.Context) {
	var p struct {
		Title    string `json:"title"`
		FolderID *int64 `json:"folder_id"`
		Content  string `json:"content"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	if p.Title == "" {
		respondError(c, http.StatusBadRequest, 400, "标题不能为空")
		return
	}
	if p.FolderID != nil && !h.folderExists(*p.FolderID) {
		respondError(c, http.StatusBadRequest, 400, "目标文件夹不存在")
		return
	}
	if h.titleExists(p.Title, p.FolderID, 0) {
		respondError(c, http.StatusConflict, 409, "同级已存在同名笔记")
		return
	}
	now := nowRFC()
	res, err := h.db.Exec(
		"INSERT INTO notes (folder_id, title, content, sort, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
		p.FolderID, p.Title, p.Content, now, now,
	)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "创建笔记失败")
		return
	}
	id, _ := res.LastInsertId()
	// 初始内容非空时存一版，作为历史起点
	if p.Content != "" {
		_, _ = h.db.Exec(
			"INSERT INTO note_versions (note_id, label, auto, content, created_at) VALUES (?, '创建', 1, ?, ?)",
			id, p.Content, now,
		)
	}
	h.getOne(c, id, http.StatusCreated)
}

// Update PUT /api/notes/:id {title?, content?, folder_id?}
// content 发生变化时自动将旧内容存为版本（去重 + 每篇自动版本上限 50）。
func (h *NoteHandler) Update(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	var p struct {
		Title    *string `json:"title"`
		Content  *string `json:"content"`
		FolderID *int64  `json:"folder_id"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}

	var cur NoteFull
	err := h.db.QueryRow(
		"SELECT id, folder_id, title, content, sort, created_at, updated_at FROM notes WHERE id = ?", id,
	).Scan(&cur.ID, &cur.FolderID, &cur.Title, &cur.Content, &cur.Sort, &cur.CreatedAt, &cur.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
		return
	}

	title := cur.Title
	if p.Title != nil {
		if *p.Title == "" {
			respondError(c, http.StatusBadRequest, 400, "标题不能为空")
			return
		}
		title = *p.Title
	}
	folderID := cur.FolderID
	if p.FolderID != nil {
		if *p.FolderID != 0 && !h.folderExists(*p.FolderID) {
			respondError(c, http.StatusBadRequest, 400, "目标文件夹不存在")
			return
		}
		if *p.FolderID == 0 {
			folderID = nil
		} else {
			folderID = p.FolderID
		}
	}
	content := cur.Content
	if p.Content != nil {
		content = *p.Content
	}
	// 同级唯一：标题或所在文件夹变化时，按落点校验（排除自身）
	if p.Title != nil || p.FolderID != nil {
		if h.titleExists(title, folderID, id) {
			respondError(c, http.StatusConflict, 409, "同级已存在同名笔记")
			return
		}
	}

	now := nowRFC()
	if _, err := h.db.Exec(
		"UPDATE notes SET folder_id = ?, title = ?, content = ?, updated_at = ? WHERE id = ?",
		folderID, title, content, now, id,
	); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "保存笔记失败")
		return
	}

	// 内容变化时自动存旧内容为版本
	if p.Content != nil && content != cur.Content {
		h.autoVersion(id, cur.Content)
	}
	h.getOne(c, id, http.StatusOK)
}

// Delete DELETE /api/notes/:id（版本级联删除）
func (h *NoteHandler) Delete(c *gin.Context) {
	id, ok := h.parseID(c)
	if !ok {
		return
	}
	res, err := h.db.Exec("DELETE FROM notes WHERE id = ?", id)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "删除笔记失败")
		return
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// Reorder POST /api/notes/reorder {type:'note'|'folder', parent_id?, ids:[按新顺序]}
func (h *NoteHandler) Reorder(c *gin.Context) {
	var p struct {
		Type     string `json:"type"`
		ParentID *int64 `json:"parent_id"`
		IDs      []int64 `json:"ids"`
	}
	if err := c.ShouldBindJSON(&p); err != nil || (p.Type != "note" && p.Type != "folder") || len(p.IDs) == 0 {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "排序失败")
		return
	}
	defer tx.Rollback()

	// ids 是拖拽落地后的完整同层列表：校验同级不重名（跨层移动落点已重名时拒绝）
	seen := make(map[string]bool, len(p.IDs))
	for _, id := range p.IDs {
		var name string
		if p.Type == "folder" {
			err = tx.QueryRow("SELECT name FROM folders WHERE id = ?", id).Scan(&name)
		} else {
			err = tx.QueryRow("SELECT title FROM notes WHERE id = ?", id).Scan(&name)
		}
		if err != nil {
			respondError(c, http.StatusBadRequest, 400, "包含无效的节点")
			return
		}
		if seen[name] {
			respondError(c, http.StatusConflict, 409, "同级已存在同名，无法移动")
			return
		}
		seen[name] = true
	}

	if p.Type == "folder" {
		for i, id := range p.IDs {
			// 防环：不能移动到自身或自己的后代之下
			if p.ParentID != nil && (isDescendantFolder(tx, *p.ParentID, id) || *p.ParentID == id) {
				respondError(c, http.StatusBadRequest, 400, "不能移动到自身或其子文件夹内")
				return
			}
			if _, err := tx.Exec(
				"UPDATE folders SET parent_id = ?, sort = ?, updated_at = ? WHERE id = ?",
				p.ParentID, i, nowRFC(), id,
			); err != nil {
				respondError(c, http.StatusInternalServerError, 500, "排序失败")
				return
			}
		}
	} else {
		for i, id := range p.IDs {
			if _, err := tx.Exec(
				"UPDATE notes SET folder_id = ?, sort = ?, updated_at = ? WHERE id = ?",
				p.ParentID, i, nowRFC(), id,
			); err != nil {
				respondError(c, http.StatusInternalServerError, 500, "排序失败")
				return
			}
		}
	}

	if err := tx.Commit(); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "排序失败")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

// ---- 内部工具 ----

func (h *NoteHandler) getOne(c *gin.Context, id int64, status int) {
	var n NoteFull
	err := h.db.QueryRow(
		"SELECT id, folder_id, title, content, sort, created_at, updated_at FROM notes WHERE id = ?", id,
	).Scan(&n.ID, &n.FolderID, &n.Title, &n.Content, &n.Sort, &n.CreatedAt, &n.UpdatedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
	case err != nil:
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
	default:
		respondOK(c, status, n)
	}
}

func (h *NoteHandler) parseID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的笔记 ID")
		return 0, false
	}
	return id, true
}

func (h *NoteHandler) folderExists(id int64) bool {
	var one int
	return h.db.QueryRow("SELECT 1 FROM folders WHERE id = ?", id).Scan(&one) == nil
}

// titleExists 同级是否已有同名笔记（parentID 为 nil 表示根层级；excludeID 用于排除自身）。
func (h *NoteHandler) titleExists(title string, parentID *int64, excludeID int64) bool {
	q := "SELECT 1 FROM notes WHERE title = ? AND id <> ? AND folder_id "
	args := []any{title, excludeID}
	if parentID == nil {
		q += "IS NULL"
	} else {
		q += "= ?"
		args = append(args, *parentID)
	}
	var one int
	return h.db.QueryRow(q, args...).Scan(&one) == nil
}

// 版本策略：保存可以频繁，但只有跨过时间阈值的编辑才产生新版本。
const (
	// autoVersionGap 距上一条自动版本不足该间隔的编辑并入同一版本（一次编辑会话只留一个检查点）
	autoVersionGap = 5 * time.Minute
	// versionRetention 自动版本最长保留时长，更早的自动版本回收
	versionRetention = 30 * 24 * time.Hour
	// versionHardLimit 每篇自动版本数量硬上限（分层保留之外的兜底）
	versionHardLimit = 120
)

// autoVersion 将旧内容存为自动版本：
//  1. 内容与最新版本相同则跳过；
//  2. 距上一条自动版本不足 autoVersionGap 时跳过——同一次编辑会话只留一个检查点；
//  3. 存入后按分层策略修剪（pruneVersions），手动快照永不删除。
func (h *NoteHandler) autoVersion(noteID int64, prevContent string) {
	var latestContent, latestAt string
	var latestAuto int
	err := h.db.QueryRow(
		"SELECT content, created_at, auto FROM note_versions WHERE note_id = ? ORDER BY id DESC LIMIT 1",
		noteID,
	).Scan(&latestContent, &latestAt, &latestAuto)
	if err == nil {
		// 内容与最近一版相同，不重复存
		if latestContent == prevContent {
			return
		}
		// 会话合并：上一条是自动版本且仍在间隔内，本次编辑并入该检查点
		if latestAuto == 1 {
			if t, e := time.Parse(time.RFC3339, latestAt); e == nil && time.Since(t) < autoVersionGap {
				return
			}
		}
	}

	if _, err := h.db.Exec(
		"INSERT INTO note_versions (note_id, label, auto, content, created_at) VALUES (?, '', 1, ?, ?)",
		noteID, prevContent, nowRFC(),
	); err != nil {
		return
	}
	h.pruneVersions(noteID)
}

// pruneVersions 分层保留自动版本（越老越稀疏），手动版本永久保留：
//
//	2 小时内    → 全留
//	2~24 小时   → 每 30 分钟 1 条
//	1~7 天      → 每 2 小时 1 条
//	7~30 天     → 每天 1 条
//	超过 30 天  → 删除
//
// 每篇自动版本另有 versionHardLimit 兜底。
func (h *NoteHandler) pruneVersions(noteID int64) {
	rows, err := h.db.Query("SELECT id, auto, created_at FROM note_versions WHERE note_id = ? ORDER BY id DESC", noteID)
	if err != nil {
		return
	}
	type versionRow struct {
		id      int64
		auto    bool
		created time.Time
	}
	list := make([]versionRow, 0, 64)
	for rows.Next() {
		var r versionRow
		var auto int
		var at string
		if rows.Scan(&r.id, &auto, &at) != nil {
			continue
		}
		r.auto = auto == 1
		t, e := time.Parse(time.RFC3339, at)
		if e != nil {
			continue // 时间不可解析的记录不参与裁剪，保持原样
		}
		r.created = t
		list = append(list, r)
	}
	rows.Close()

	now := time.Now()
	buckets := make(map[string]bool, len(list))
	keep := make(map[int64]bool, len(list))
	autoKept := 0
	// list 按 id 倒序（新→旧）：每个时间桶保留遇到的第一条，即该桶最新的一条
	for _, r := range list {
		if !r.auto {
			keep[r.id] = true // 手动快照永久保留
			continue
		}
		age := now.Sub(r.created)
		if age > versionRetention {
			continue // 超期，删除
		}
		if autoKept >= versionHardLimit {
			continue // 超出硬上限，删除较老的
		}
		var bucket string
		switch {
		case age <= 2*time.Hour:
			bucket = "raw:" + strconv.FormatInt(r.id, 10) // 全留：每条独立成桶
		case age <= 24*time.Hour:
			bucket = "30m:" + r.created.UTC().Truncate(30*time.Minute).Format("200601021504")
		case age <= 7*24*time.Hour:
			bucket = "2h:" + r.created.UTC().Truncate(2*time.Hour).Format("2006010215")
		default:
			bucket = "1d:" + r.created.UTC().Format("20060102")
		}
		if buckets[bucket] {
			continue
		}
		buckets[bucket] = true
		keep[r.id] = true
		autoKept++
	}

	var stale []int64
	for _, r := range list {
		if !keep[r.id] {
			stale = append(stale, r.id)
		}
	}
	if len(stale) == 0 {
		return
	}
	tx, err := h.db.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare("DELETE FROM note_versions WHERE id = ?")
	if err != nil {
		return
	}
	defer stmt.Close()
	for _, id := range stale {
		if _, err := stmt.Exec(id); err != nil {
			return
		}
	}
	_ = tx.Commit()
}

// isDescendantFolder 判断 folderID 是否位于 maybeAncestor 的子树内（用于移动防环）。
func isDescendantFolder(tx *sql.Tx, folderID, maybeAncestor int64) bool {
	current := folderID
	for depth := 0; depth < 64; depth++ {
		var parent sql.NullInt64
		if err := tx.QueryRow("SELECT parent_id FROM folders WHERE id = ?", current).Scan(&parent); err != nil {
			return false
		}
		if !parent.Valid {
			return false
		}
		if parent.Int64 == maybeAncestor {
			return true
		}
		current = parent.Int64
	}
	return false
}
