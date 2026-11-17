// 附件引用扫描：供主进程孤儿回收使用。
// 扫描所有笔记与全部版本内容，收集被引用的附件文件名（attach://<name> 形式）。
package api

import (
	"database/sql"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
)

// 内容寻址附件名：<16位hex>.<扩展名>
var attachmentRefRe = regexp.MustCompile(`attach://([a-f0-9]{16}\.(?:png|jpe?g|gif|webp|svg|bmp|avif))`)

// ReferencedAttachments GET /api/attachments/referenced
func (h *NoteHandler) ReferencedAttachments(c *gin.Context) {
	seen := map[string]bool{}
	names := make([]string, 0)

	scan := func(rows *sql.Rows, err error) {
		if err != nil {
			return
		}
		defer rows.Close()
		for rows.Next() {
			var content string
			if rows.Scan(&content) != nil {
				continue
			}
			for _, m := range attachmentRefRe.FindAllStringSubmatch(content, -1) {
				if !seen[m[1]] {
					seen[m[1]] = true
					names = append(names, m[1])
				}
			}
		}
	}

	scan(h.db.Query("SELECT content FROM notes"))
	scan(h.db.Query("SELECT content FROM note_versions"))

	respondOK(c, http.StatusOK, gin.H{"names": names})
}
