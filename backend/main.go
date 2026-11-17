// myDash 后端：Electron 的子进程，提供本机 REST API + SQLite 存储。
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"mydash/backend/internal/api"
	"mydash/backend/internal/db"
	"mydash/backend/internal/server"
)

func main() {
	port := flag.Int("port", 0, "HTTP 监听端口（0 表示随机分配）")
	dbPath := flag.String("db", "mydash.db", "SQLite 数据库文件路径")
	token := flag.String("token", "", "API 访问令牌（为空则不校验）")
	flag.Parse()

	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("打开数据库失败: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}

	router := server.New(
		api.NewFolderHandler(database),
		api.NewNoteHandler(database),
		api.NewVersionHandler(database),
		api.NewAdminHandler(database, *dbPath),
		api.NewTodoHandler(database),
		api.NewToolsHandler(),
		*token,
	)

	addr := fmt.Sprintf("127.0.0.1:%d", *port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("监听 %s 失败: %v", addr, err)
	}
	// 主进程通过该行确认后端就绪，并拿到实际端口
	fmt.Printf("READY port=%d\n", ln.Addr().(*net.TCPAddr).Port)

	srv := &http.Server{Handler: router}
	go func() {
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP 服务异常退出: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	// 看门狗：父进程（Electron）异常退出时 stdin 管道会关闭，据此自动退出，避免孤儿进程
	go func() {
		_, _ = io.Copy(io.Discard, os.Stdin)
		log.Println("检测到父进程退出，后端自动关闭")
		quit <- syscall.SIGTERM
	}()

	<-quit
	log.Println("正在关闭后端服务...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("HTTP 服务关闭超时: %v", err)
	}
}
