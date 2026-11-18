// seed-todos 生成一批模拟待办数据，便于联调与演示。
//
//	go run ./cmd/seed-todos            # 写入（默认 %AppData%/mydash/mydash.db）
//	go run ./cmd/seed-todos -db <路径> # 指定数据库
//	go run ./cmd/seed-todos -clean     # 删除本工具写入的数据（按清单精确回滚）
//
// 只增不改：不会动你已有的待办；分类/标签若重名则复用，清理时也只删自己新建的。
package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"mydash/backend/internal/db"
)

const manifestName = "seed-todos.json"

type manifest struct {
	CreatedAt   string  `json:"createdAt"`
	TodoIDs     []int64 `json:"todoIds"`
	CategoryIDs []int64 `json:"categoryIds"`
	TagIDs      []int64 `json:"tagIds"`
}

type seedTodo struct {
	cat      string
	title    string
	sub      string
	desc     string
	pri      int
	status   string
	due      string // 空表示无截止时间
	start    string
	warn     int // 提前提醒分钟数，0 表示不提醒
	tags     []string
	subs     []seedTodo
	comments []string
}

func main() {
	dbPath := flag.String("db", "", "SQLite 路径（默认 %AppData%/mydash/mydash.db）")
	clean := flag.Bool("clean", false, "删除本工具写入的数据")
	stats := flag.Bool("stats", false, "只打印待办分布，不写入")
	flag.Parse()

	path := *dbPath
	if path == "" {
		dir, err := os.UserConfigDir()
		if err != nil {
			fail("无法定位用户配置目录: %v", err)
		}
		path = filepath.Join(dir, "mydash", "mydash.db")
	}
	if _, err := os.Stat(path); err != nil {
		fail("数据库不存在：%s\n请先启动一次应用让它完成初始化。", path)
	}

	handle, err := db.Open(path)
	if err != nil {
		fail("打开数据库失败: %v", err)
	}
	defer handle.Close()
	if err := db.Migrate(handle); err != nil {
		fail("迁移数据库失败: %v", err)
	}

	manifestPath := filepath.Join(filepath.Dir(path), manifestName)
	if *stats {
		runStats(handle)
		return
	}
	if *clean {
		runClean(handle, manifestPath)
		return
	}
	runSeed(handle, manifestPath)
}

// runStats 打印待办按分类与状态的分布，便于核对数据
func runStats(handle *sql.DB) {
	rows, err := handle.Query(
		`SELECT IFNULL(c.name, '(未分类)'), t.status, COUNT(*)
		   FROM todos t LEFT JOIN todo_categories c ON c.id = t.category_id
		  GROUP BY c.name, t.status ORDER BY c.name, t.status`,
	)
	if err != nil {
		fail("查询失败: %v", err)
	}
	defer rows.Close()

	fmt.Println("分类\t状态\t数量")
	total := 0
	for rows.Next() {
		var cat, status string
		var n int
		if err := rows.Scan(&cat, &status, &n); err != nil {
			fail("读取失败: %v", err)
		}
		fmt.Printf("%s\t%s\t%d\n", cat, status, n)
		total += n
	}
	fmt.Printf("合计 %d 条\n", total)
}

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}

// at 返回相对今天的某个时刻（UTC RFC3339，与后端写入格式一致）
func at(days, hour, minute int) string {
	base := time.Now().AddDate(0, 0, days)
	t := time.Date(base.Year(), base.Month(), base.Day(), hour, minute, 0, 0, time.Local)
	return t.UTC().Format(time.RFC3339)
}

func nowRFC() string { return time.Now().UTC().Format(time.RFC3339) }

func runSeed(handle *sql.DB, manifestPath string) {
	now := nowRFC()
	tx, err := handle.Begin()
	if err != nil {
		fail("开启事务失败: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	cats := map[string]int64{}
	createdCats := []int64{}
	for _, name := range []string{"工作", "生活", "学习", "健康"} {
		id, created, err := ensureCategory(tx, name)
		if err != nil {
			fail("创建分类 %s 失败: %v", name, err)
		}
		cats[name] = id
		if created {
			createdCats = append(createdCats, id)
		}
	}

	tagIDs := map[string]int64{}
	createdTags := []int64{}
	for _, name := range []string{"紧急", "会议", "沟通", "写作", "复盘", "采购", "阅读", "运动", "深度工作"} {
		id, created, err := ensureTag(tx, name)
		if err != nil {
			fail("创建标签 %s 失败: %v", name, err)
		}
		tagIDs[name] = id
		if created {
			createdTags = append(createdTags, id)
		}
	}

	sortByCat := map[string]int{}
	var allIDs []int64
	total := 0
	for _, t := range fixture() {
		catID, ok := cats[t.cat]
		if !ok {
			continue
		}
		sort := sortByCat[t.cat]
		sortByCat[t.cat] = sort + 1
		n, err := insertTodo(tx, t, catID, nil, sort, now, tagIDs, &allIDs)
		if err != nil {
			fail("写入待办「%s」失败: %v", t.title, err)
		}
		total += n
	}

	if err := tx.Commit(); err != nil {
		fail("提交事务失败: %v", err)
	}

	m := manifest{CreatedAt: now, TodoIDs: allIDs, CategoryIDs: createdCats, TagIDs: createdTags}
	if err := writeManifest(manifestPath, m); err != nil {
		fmt.Printf("警告：清单写入失败（清理将不可用）: %v\n", err)
	}
	fmt.Printf("已写入 %d 条待办（含子任务），分类 %d 个，标签 %d 个。\n", total, len(cats), len(tagIDs))
	fmt.Printf("清单：%s\n清理：go run ./cmd/seed-todos -clean\n", manifestPath)
}

func runClean(handle *sql.DB, manifestPath string) {
	raw, err := os.ReadFile(manifestPath)
	if err != nil {
		fail("没有找到清单文件 %s，无法确定要删除哪些数据。", manifestPath)
	}
	var m manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		fail("清单文件损坏: %v", err)
	}

	tx, err := handle.Begin()
	if err != nil {
		fail("开启事务失败: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	deleted := 0
	for _, id := range m.TodoIDs {
		res, err := tx.Exec("DELETE FROM todos WHERE id = ?", id)
		if err != nil {
			fail("删除待办 %d 失败: %v", id, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			deleted++
		}
	}
	for _, id := range m.CategoryIDs {
		if _, err := tx.Exec("DELETE FROM todo_categories WHERE id = ?", id); err != nil {
			fail("删除分类 %d 失败: %v", id, err)
		}
	}
	for _, id := range m.TagIDs {
		if _, err := tx.Exec("DELETE FROM todo_tags WHERE id = ?", id); err != nil {
			fail("删除标签 %d 失败: %v", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		fail("提交事务失败: %v", err)
	}
	_ = os.Remove(manifestPath)
	fmt.Printf("已删除 %d 条待办，以及本工具创建的分类与标签。\n", deleted)
}

func ensureCategory(tx *sql.Tx, name string) (int64, bool, error) {
	var id int64
	err := tx.QueryRow("SELECT id FROM todo_categories WHERE name = ? LIMIT 1", name).Scan(&id)
	if err == nil {
		return id, false, nil
	}
	if err != sql.ErrNoRows {
		return 0, false, err
	}
	now := nowRFC()
	res, err := tx.Exec(
		"INSERT INTO todo_categories (name, sort, created_at, updated_at) VALUES (?, 0, ?, ?)",
		name, now, now,
	)
	if err != nil {
		return 0, false, err
	}
	id, _ = res.LastInsertId()
	return id, true, nil
}

func ensureTag(tx *sql.Tx, name string) (int64, bool, error) {
	var id int64
	err := tx.QueryRow("SELECT id FROM todo_tags WHERE name = ? LIMIT 1", name).Scan(&id)
	if err == nil {
		return id, false, nil
	}
	if err != sql.ErrNoRows {
		return 0, false, err
	}
	res, err := tx.Exec("INSERT INTO todo_tags (name, created_at) VALUES (?, ?)", name, nowRFC())
	if err != nil {
		return 0, false, err
	}
	id, _ = res.LastInsertId()
	return id, true, nil
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullInt(n int) any {
	if n <= 0 {
		return nil
	}
	return n
}

// insertTodo 递归写入待办与子任务，返回写入条数
func insertTodo(tx *sql.Tx, t seedTodo, catID int64, parentID *int64, sort int, now string, tagIDs map[string]int64, out *[]int64) (int, error) {
	completedAt := any(nil)
	if t.status == "done" {
		completedAt = now
	}
	res, err := tx.Exec(
		`INSERT INTO todos
		 (category_id, parent_id, title, subtitle, description, priority, status,
		  start_at, due_at, warn_minutes, sort, completed_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		catID, parentID, t.title, t.sub, t.desc, t.pri, t.status,
		nullStr(t.start), nullStr(t.due), nullInt(t.warn), sort, completedAt, now, now,
	)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	*out = append(*out, id)

	for _, name := range t.tags {
		tagID, ok := tagIDs[name]
		if !ok {
			continue
		}
		if _, err := tx.Exec("INSERT OR IGNORE INTO todo_todo_tag (todo_id, tag_id) VALUES (?, ?)", id, tagID); err != nil {
			return 0, err
		}
	}
	for _, c := range t.comments {
		if _, err := tx.Exec(
			"INSERT INTO todo_comments (todo_id, content, created_at) VALUES (?, ?, ?)", id, c, now,
		); err != nil {
			return 0, err
		}
	}

	count := 1
	for i, s := range t.subs {
		sub := s
		sub.cat = t.cat
		if sub.pri == 0 {
			sub.pri = t.pri
		}
		if sub.status == "" {
			sub.status = "open"
		}
		pid := id
		n, err := insertTodo(tx, sub, catID, &pid, i, now, tagIDs, out)
		if err != nil {
			return count, err
		}
		count += n
	}
	return count, nil
}

func writeManifest(path string, m manifest) error {
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o644)
}

// fixture 模拟数据：覆盖逾期、今天、本周、已完成、已关闭、子任务、标签、评论
func fixture() []seedTodo {
	open := "open"
	done := "done"
	closed := "closed"

	return []seedTodo{
		// ---- 工作 ----
		{
			cat: "工作", title: "完成 Q4 产品路线图评审", pri: 1, status: open,
			sub: "材料已备齐，等评审会确认优先级", due: at(-2, 18, 0), warn: 120,
			tags: []string{"紧急", "会议"},
			desc: "评审范围：桌面端 4 条主线 + AI 工作台的后续排期。需要输出一版优先级矩阵。",
			subs: []seedTodo{
				{title: "收集各部门需求", status: done, pri: 2},
				{title: "整理竞品近三个月更新", status: done, pri: 2},
				{title: "产出评审 PPT", status: open, pri: 1, due: at(-2, 12, 0)},
			},
			comments: []string{"评审会改到周四下午 3 点，会议室 A。", "把插件生态那条线的数据补上。"},
		},
		{
			cat: "工作", title: "修复登录页偶发白屏", pri: 1, status: open,
			due: at(0, 18, 0), warn: 60, tags: []string{"紧急"},
			desc: "低概率复现：token 刷新与首屏渲染竞态。需要加兜底超时并补日志。",
			comments: []string{"已在测试环境复现两次，抓到了 network 面板。"},
		},
		{
			cat: "工作", title: "撰写 11 月项目周报", pri: 2, status: open,
			due: at(1, 17, 30), tags: []string{"写作", "复盘"},
			desc: "含本周进展、风险项、下周计划三部分。",
		},
		{
			cat: "工作", title: "与设计对齐新版首页视觉", pri: 2, status: open,
			due: at(2, 10, 0), tags: []string{"沟通", "会议"},
		},
		{
			cat: "工作", title: "梳理插件系统权限模型", pri: 3, status: open,
			due: at(5, 18, 0), tags: []string{"深度工作"},
			desc: "当前 permissions 只是声明式约束，需要明确哪些能力必须在主进程拦截。",
		},
		{
			cat: "工作", title: "补齐 API 文档与示例", pri: 3, status: open,
			due: at(7, 18, 0), tags: []string{"写作"},
			subs: []seedTodo{
				{title: "笔记接口", status: done},
				{title: "待办接口", status: open},
				{title: "附件与导出口径", status: open},
			},
		},
		{
			cat: "工作", title: "完成第五轮用户访谈", pri: 2, status: done,
			tags: []string{"沟通", "复盘"},
			desc: "5 位重度用户，已整理共性问题清单。",
		},
		{
			cat: "工作", title: "归档上季度合同与发票", pri: 4, status: closed,
		},

		// ---- 生活 ----
		{
			cat: "生活", title: "交本月物业费", pri: 1, status: open,
			due: at(-1, 20, 0), warn: 60, tags: []string{"紧急"},
		},
		{
			cat: "生活", title: "预约牙齿检查", pri: 2, status: open,
			due: at(3, 10, 0), tags: []string{"沟通"},
			comments: []string{"上次医生建议半年复查一次，已经拖了两个月。"},
		},
		{
			cat: "生活", title: "买猫粮和猫砂", pri: 3, status: open,
			due: at(1, 19, 0), tags: []string{"采购"},
		},
		{
			cat: "生活", title: "更换空调滤网", pri: 4, status: open,
			due: at(10, 12, 0),
		},
		{
			cat: "生活", title: "给车做保养", pri: 3, status: open,
			due: at(14, 9, 0), tags: []string{"采购"},
			desc: "里程接近 3 万公里，顺便检查轮胎。",
		},
		{
			cat: "生活", title: "整理书房与书架", pri: 4, status: done,
		},

		// ---- 学习 ----
		{
			cat: "学习", title: "读完《设计数据密集型应用》第 6 章", pri: 2, status: open,
			due: at(4, 22, 0), tags: []string{"阅读"},
			subs: []seedTodo{
				{title: "分区与复制策略", status: done},
				{title: "事务隔离级别笔记", status: open},
			},
		},
		{
			cat: "学习", title: "完成 Rust 异步编程练习", pri: 3, status: open,
			due: at(6, 22, 0), tags: []string{"深度工作"},
		},
		{
			cat: "学习", title: "整理 TypeScript 类型体操笔记", pri: 3, status: open,
			due: at(9, 22, 0), tags: []string{"写作"},
		},
		{
			cat: "学习", title: "准备技术分享：桌面端 SQLite 实践", pri: 2, status: open,
			due: at(12, 15, 0), tags: []string{"写作", "会议"},
			desc: "重点讲 WAL、迁移策略与备份一致性。",
			subs: []seedTodo{
				{title: "列提纲", status: done},
				{title: "准备演示仓库", status: open, due: at(9, 20, 0)},
				{title: "试讲一遍", status: open, due: at(11, 20, 0)},
			},
		},
		{
			cat: "学习", title: "看完成都 meetup 回放", pri: 4, status: done,
			tags: []string{"阅读"},
		},

		// ---- 健康 ----
		{
			cat: "健康", title: "本周三次力量训练", pri: 3, status: open,
			due: at(2, 21, 0), tags: []string{"运动"},
			subs: []seedTodo{
				{title: "周一 上肢推拉", status: done},
				{title: "周三 下肢", status: open},
				{title: "周五 核心与有氧", status: open},
			},
		},
		{
			cat: "健康", title: "预约年度体检", pri: 2, status: open,
			due: at(8, 11, 0), tags: []string{"沟通"},
		},
		{
			cat: "健康", title: "每天走够 8000 步", pri: 4, status: open,
			tags: []string{"运动"},
		},
		{
			cat: "健康", title: "记录一周饮食", pri: 4, status: done,
		},
	}
}
