// 文件夹（笔记树节点）接口。
package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Folder 是笔记树的文件夹节点，parent_id 为空表示根层级。
type Folder struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	ParentID  *int64  `json:"parent_id"`
	Sort      int     `json:"sort"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

type FolderHandler struct {
	db *sql.DB
}

func NewFolderHandler(db *sql.DB) *FolderHandler { return &FolderHandler{db: db} }

// List GET /api/folders —— 平铺列表，前端组装树。
func (h *FolderHandler) List(c *gin.Context) {
	rows, err := h.db.Query("SELECT id, name, parent_id, sort, created_at, updated_at FROM folders ORDER BY sort, id")
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询文件夹失败")
		return
	}
	defer rows.Close()

	list := make([]Folder, 0)
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &f.Sort, &f.CreatedAt, &f.UpdatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取文件夹失败")
			return
		}
		list = append(list, f)
	}
	respondOK(c, http.StatusOK, list)
}

// Create POST /api/folders {name, parent_id?}
func (h *FolderHandler) Create(c *gin.Context) {
	var p struct {
		Name     string `json:"name"`
		ParentID *int64 `json:"parent_id"`
	}
	if err := c.ShouldBindJSON(&p); err != nil || p.Name == "" {
		respondError(c, http.StatusBadRequest, 400, "名称不能为空")
		return
	}
	if p.ParentID != nil && !h.exists(*p.ParentID) {
		respondError(c, http.StatusBadRequest, 400, "父文件夹不存在")
		return
	}
	if h.nameExists(p.Name, p.ParentID, 0) {
		respondError(c, http.StatusConflict, 409, "同级已存在同名文件夹")
		return
	}
	now := nowRFC()
	res, err := h.db.Exec(
		"INSERT INTO folders (name, parent_id, sort, created_at, updated_at) VALUES (?, ?, 0, ?, ?)",
		p.Name, p.ParentID, now, now,
	)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "创建文件夹失败")
		return
	}
	id, _ := res.LastInsertId()
	h.getOne(c, id, http.StatusCreated)
}

// Update PUT /api/folders/:id {name?, sort?} —— 移动/排序走 reorder 接口
func (h *FolderHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的文件夹 ID")
		return
	}
	var p struct {
		Name *string `json:"name"`
		Sort *int    `json:"sort"`
	}
	if err := c.ShouldBindJSON(&p); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求参数无效")
		return
	}
	if p.Name != nil {
		if *p.Name == "" {
			respondError(c, http.StatusBadRequest, 400, "名称不能为空")
			return
		}
		// 同级唯一：以自身当前父级为基准，排除自己
		var parent sql.NullInt64
		if err := h.db.QueryRow("SELECT parent_id FROM folders WHERE id = ?", id).Scan(&parent); err != nil {
			respondError(c, http.StatusNotFound, 404, "文件夹不存在")
			return
		}
		var pid *int64
		if parent.Valid {
			pid = &parent.Int64
		}
		if h.nameExists(*p.Name, pid, id) {
			respondError(c, http.StatusConflict, 409, "同级已存在同名文件夹")
			return
		}
		if _, err := h.db.Exec("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?", *p.Name, nowRFC(), id); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "重命名失败")
			return
		}
	}
	if p.Sort != nil {
		if _, err := h.db.Exec("UPDATE folders SET sort = ?, updated_at = ? WHERE id = ?", *p.Sort, nowRFC(), id); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "排序失败")
			return
		}
	}
	h.getOne(c, id, http.StatusOK)
}

// Delete DELETE /api/folders/:id —— 外键级联删除子文件夹与其中的笔记（含版本）
func (h *FolderHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的文件夹 ID")
		return
	}
	if !h.exists(id) {
		respondError(c, http.StatusNotFound, 404, "文件夹不存在")
		return
	}
	if _, err := h.db.Exec("DELETE FROM folders WHERE id = ?", id); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "删除文件夹失败")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

func (h *FolderHandler) getOne(c *gin.Context, id int64, status int) {
	var f Folder
	err := h.db.QueryRow(
		"SELECT id, name, parent_id, sort, created_at, updated_at FROM folders WHERE id = ?", id,
	).Scan(&f.ID, &f.Name, &f.ParentID, &f.Sort, &f.CreatedAt, &f.UpdatedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, http.StatusNotFound, 404, "文件夹不存在")
	case err != nil:
		respondError(c, http.StatusInternalServerError, 500, "查询文件夹失败")
	default:
		respondOK(c, status, f)
	}
}

func (h *FolderHandler) exists(id int64) bool {
	var one int
	return h.db.QueryRow("SELECT 1 FROM folders WHERE id = ?", id).Scan(&one) == nil
}

// nameExists 同级是否已有同名文件夹（excludeID 用于重命名排除自身）。
func (h *FolderHandler) nameExists(name string, parentID *int64, excludeID int64) bool {
	q := "SELECT 1 FROM folders WHERE name = ? AND id <> ? AND parent_id "
	args := []any{name, excludeID}
	if parentID == nil {
		q += "IS NULL"
	} else {
		q += "= ?"
		args = append(args, *parentID)
	}
	var one int
	return h.db.QueryRow(q, args...).Scan(&one) == nil
}
