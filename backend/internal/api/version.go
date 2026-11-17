// 笔记版本接口：列表/内容/手动快照/还原。
package api

import (
	"database/sql"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type VersionMeta struct {
	ID        int64  `json:"id"`
	NoteID    int64  `json:"note_id"`
	Label     string `json:"label"`
	Auto      bool   `json:"auto"`
	Size      int    `json:"size"`
	CreatedAt string `json:"created_at"`
}

type VersionHandler struct {
	db *sql.DB
}

func NewVersionHandler(db *sql.DB) *VersionHandler { return &VersionHandler{db: db} }

// List GET /api/notes/:id/versions —— 元数据（新→旧），不含正文。
func (h *VersionHandler) List(c *gin.Context) {
	noteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || noteID <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的笔记 ID")
		return
	}
	rows, err := h.db.Query(
		"SELECT id, note_id, label, auto, LENGTH(content), created_at FROM note_versions WHERE note_id = ? ORDER BY id DESC",
		noteID,
	)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询版本失败")
		return
	}
	defer rows.Close()

	list := make([]VersionMeta, 0)
	for rows.Next() {
		var v VersionMeta
		var auto int
		if err := rows.Scan(&v.ID, &v.NoteID, &v.Label, &auto, &v.Size, &v.CreatedAt); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "读取版本失败")
			return
		}
		v.Auto = auto == 1
		list = append(list, v)
	}
	respondOK(c, http.StatusOK, list)
}

// Get GET /api/notes/:id/versions/:vid —— 版本正文。
func (h *VersionHandler) Get(c *gin.Context) {
	noteID, vid, ok := parseNoteVersionIDs(c)
	if !ok {
		return
	}
	var content string
	err := h.db.QueryRow(
		"SELECT content FROM note_versions WHERE note_id = ? AND id = ?", noteID, vid,
	).Scan(&content)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, http.StatusNotFound, 404, "版本不存在")
	case err != nil:
		respondError(c, http.StatusInternalServerError, 500, "查询版本失败")
	default:
		respondOK(c, http.StatusOK, gin.H{"content": content})
	}
}

// Create POST /api/notes/:id/versions {label?} —— 手动快照当前内容。
func (h *VersionHandler) Create(c *gin.Context) {
	noteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || noteID <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的笔记 ID")
		return
	}
	var p struct {
		Label string `json:"label"`
	}
	_ = c.ShouldBindJSON(&p)

	var content string
	err = h.db.QueryRow("SELECT content FROM notes WHERE id = ?", noteID).Scan(&content)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
	case err != nil:
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
		return
	}

	now := nowRFC()
	res, err := h.db.Exec(
		"INSERT INTO note_versions (note_id, label, auto, content, created_at) VALUES (?, ?, 0, ?, ?)",
		noteID, p.Label, content, now,
	)
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "保存版本失败")
		return
	}
	vid, _ := res.LastInsertId()
	respondOK(c, http.StatusCreated, gin.H{"id": vid, "label": p.Label})
}

// Restore POST /api/notes/:id/versions/:vid/restore —— 当前内容先自动存版本，再写回快照。
func (h *VersionHandler) Restore(c *gin.Context) {
	noteID, vid, ok := parseNoteVersionIDs(c)
	if !ok {
		return
	}

	var versionContent string
	err := h.db.QueryRow(
		"SELECT content FROM note_versions WHERE note_id = ? AND id = ?", noteID, vid,
	).Scan(&versionContent)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "版本不存在")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询版本失败")
		return
	}

	var current string
	err = h.db.QueryRow("SELECT content FROM notes WHERE id = ?", noteID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) {
		respondError(c, http.StatusNotFound, 404, "笔记不存在")
		return
	}
	if err != nil {
		respondError(c, http.StatusInternalServerError, 500, "查询笔记失败")
		return
	}

	now := nowRFC()
	if current != versionContent {
		if _, err := h.db.Exec(
			"INSERT INTO note_versions (note_id, label, auto, content, created_at) VALUES (?, '还原前', 1, ?, ?)",
			noteID, current, now,
		); err != nil {
			respondError(c, http.StatusInternalServerError, 500, "保存当前版本失败")
			return
		}
	}
	if _, err := h.db.Exec(
		"UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", versionContent, now, noteID,
	); err != nil {
		respondError(c, http.StatusInternalServerError, 500, "还原失败")
		return
	}
	respondOK(c, http.StatusOK, nil)
}

func parseNoteVersionIDs(c *gin.Context) (noteID, vid int64, ok bool) {
	noteID, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || noteID <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的笔记 ID")
		return 0, 0, false
	}
	vid, err = strconv.ParseInt(c.Param("vid"), 10, 64)
	if err != nil || vid <= 0 {
		respondError(c, http.StatusBadRequest, 400, "无效的版本 ID")
		return 0, 0, false
	}
	return noteID, vid, true
}
