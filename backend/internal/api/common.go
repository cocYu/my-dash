// 通用助手：统一响应与时间格式。
package api

import (
	"time"

	"github.com/gin-gonic/gin"
)

func nowRFC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func respondOK(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{"code": 0, "message": "ok", "data": data})
}

func respondError(c *gin.Context, httpStatus, code int, message string) {
	c.JSON(httpStatus, gin.H{"code": code, "message": message})
}
