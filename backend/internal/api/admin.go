// Package api: 管理端点（备份/还原支持）。
package api

import (
	"database/sql"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

// AdminHandler 提供数据管理端点。
type AdminHandler struct {
	db     *sql.DB
	dbPath string
}

func NewAdminHandler(db *sql.DB, dbPath string) *AdminHandler {
	return &AdminHandler{db: db, dbPath: dbPath}
}

// Snapshot GET /api/admin/db/snapshot
// 用 VACUUM INTO 生成一致性快照（WAL 模式下直接拷贝热文件不安全），返回后删除临时文件。
func (h *AdminHandler) Snapshot(c *gin.Context) {
	tmp := h.dbPath + ".snapshot-tmp"
	_ = os.Remove(tmp) // VACUUM INTO 要求目标文件不存在

	if _, err := h.db.Exec("VACUUM INTO ?", tmp); err != nil {
		_ = os.Remove(tmp)
		respondError(c, http.StatusInternalServerError, 500, "生成数据库快照失败: "+err.Error())
		return
	}
	defer os.Remove(tmp)

	c.Header("Content-Disposition", `attachment; filename="mydash-snapshot.db"`)
	c.File(tmp)
}
