// Package server 组装 Gin 引擎：CORS、Token 校验与业务路由。
package server

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"mydash/backend/internal/api"
)

const headerToken = "X-API-Token"

// New 创建 Gin 引擎。token 非空时所有 /api 接口都要求携带 X-API-Token。
func New(folderHandler *api.FolderHandler, noteHandler *api.NoteHandler, versionHandler *api.VersionHandler, adminHandler *api.AdminHandler, todoHandler *api.TodoHandler, toolsHandler *api.ToolsHandler, token string) http.Handler {
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger(), corsMiddleware())
	if token != "" {
		r.Use(tokenMiddleware(token))
	}

	apiGroup := r.Group("/api")
	{
		apiGroup.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{"code": 0, "message": "ok", "data": gin.H{"status": "up"}})
		})

		// 文件夹树
		apiGroup.GET("/folders", folderHandler.List)
		apiGroup.POST("/folders", folderHandler.Create)
		apiGroup.PUT("/folders/:id", folderHandler.Update)
		apiGroup.DELETE("/folders/:id", folderHandler.Delete)

		// 笔记
		apiGroup.GET("/notes", noteHandler.List)
		apiGroup.POST("/notes", noteHandler.Create)
		apiGroup.POST("/notes/reorder", noteHandler.Reorder)
		apiGroup.GET("/notes/:id", noteHandler.Get)
		apiGroup.PUT("/notes/:id", noteHandler.Update)
		apiGroup.DELETE("/notes/:id", noteHandler.Delete)

		// 全文检索（标题 + 正文，供 Agent 工具使用）
		apiGroup.GET("/search/notes", noteHandler.Search)

		// 笔记版本
		apiGroup.GET("/notes/:id/versions", versionHandler.List)
		apiGroup.POST("/notes/:id/versions", versionHandler.Create)
		apiGroup.GET("/notes/:id/versions/:vid", versionHandler.Get)
		apiGroup.POST("/notes/:id/versions/:vid/restore", versionHandler.Restore)

		// 管理：数据库快照（供主进程备份打包）
		apiGroup.GET("/admin/db/snapshot", adminHandler.Snapshot)

		// 附件引用扫描（供主进程孤儿回收）
		apiGroup.GET("/attachments/referenced", noteHandler.ReferencedAttachments)

		// 待办
		apiGroup.GET("/todos", todoHandler.List)
		apiGroup.POST("/todos", todoHandler.Create)
		apiGroup.PUT("/todos/:id", todoHandler.Update)
		apiGroup.POST("/todos/:id/status", todoHandler.SetStatus)
		apiGroup.DELETE("/todos/:id", todoHandler.Delete)
		apiGroup.GET("/todos/:id/comments", todoHandler.ListComments)
		apiGroup.POST("/todos/:id/comments", todoHandler.CreateComment)
		apiGroup.DELETE("/todos/:id/comments/:cid", todoHandler.DeleteComment)
		apiGroup.GET("/todo-categories", todoHandler.ListCategories)
		apiGroup.POST("/todo-categories", todoHandler.CreateCategory)
		apiGroup.PUT("/todo-categories/:id", todoHandler.UpdateCategory)
		apiGroup.DELETE("/todo-categories/:id", todoHandler.DeleteCategory)
		apiGroup.GET("/todo-tags", todoHandler.ListTags)

		// 工具箱：通用 HTTP 代理（简易 Postman 用，带 SSRF 防护）
		apiGroup.POST("/tools/proxy", toolsHandler.Proxy)
	}
	return r
}

// corsMiddleware 渲染进程经 file:// 或 dev server 跨域访问本机 API；
// 已有 Token 防护，允许任意来源是安全的。
func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, X-API-Token")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func tokenMiddleware(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader(headerToken) != token {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "无效的访问令牌"})
			return
		}
		c.Next()
	}
}
