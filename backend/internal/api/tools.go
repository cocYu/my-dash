// 工具类接口：通用 HTTP 代理（工具箱·简易 Postman 使用）。
// 渲染层受 CORS 限制无法直连任意域，由本机后端代为转发；
// 带 SSRF 防护（禁本机/内网目标）、超时与响应体上限。
package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

const (
	proxyDefaultTimeout   = 15 * time.Second
	proxyMaxTimeout       = 60 * time.Second
	proxyMaxResponseBytes = 10 << 20 // 10MB
	proxyMaxBodyBytes     = 10 << 20
)

type proxyRequest struct {
	URL       string            `json:"url" binding:"required"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
	TimeoutMs int               `json:"timeoutMs"`
}

type ToolsHandler struct{}

func NewToolsHandler() *ToolsHandler {
	return &ToolsHandler{}
}

// checkTarget 校验目标地址：仅 http/https，且解析出的 IP 不得为本机/内网/链路本地地址
// （防利用代理探测本机其他服务——SSRF 防护）。重定向的每一跳也会复检。
func checkTarget(u *url.URL) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("仅支持 http/https 协议")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL 缺少主机名")
	}
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("域名解析失败: %v", err)
	}
	for _, ip := range ips {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return fmt.Errorf("禁止访问本机/内网地址: %s", ip)
		}
	}
	return nil
}

func (h *ToolsHandler) client() *http.Client {
	return &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("重定向次数过多")
			}
			return checkTarget(req.URL)
		},
	}
}

// Proxy 转发任意 HTTP 请求并回传响应。POST /api/tools/proxy
func (h *ToolsHandler) Proxy(c *gin.Context) {
	var req proxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		respondError(c, http.StatusBadRequest, 400, "请求体格式错误")
		return
	}
	if len(req.Body) > proxyMaxBodyBytes {
		respondError(c, http.StatusRequestEntityTooLarge, 413, "请求体超过 10MB 上限")
		return
	}
	u, err := url.Parse(req.URL)
	if err != nil || u.Host == "" {
		respondError(c, http.StatusBadRequest, 400, "URL 无效")
		return
	}
	if err := checkTarget(u); err != nil {
		respondError(c, http.StatusForbidden, 403, err.Error())
		return
	}

	method := strings.ToUpper(req.Method)
	if method == "" {
		method = http.MethodGet
	}
	var bodyReader io.Reader
	if req.Body != "" {
		bodyReader = strings.NewReader(req.Body)
	}
	outReq, err := http.NewRequest(method, req.URL, bodyReader)
	if err != nil {
		respondError(c, http.StatusBadRequest, 400, fmt.Sprintf("构造请求失败: %v", err))
		return
	}
	for k, v := range req.Headers {
		// 不透传本机 API 鉴权头与 Host
		if strings.EqualFold(k, "X-API-Token") || strings.EqualFold(k, "Host") {
			continue
		}
		outReq.Header.Set(k, v)
	}
	if outReq.Header.Get("User-Agent") == "" {
		outReq.Header.Set("User-Agent", "AtoZ-Postman/1.0")
	}

	timeout := proxyDefaultTimeout
	if req.TimeoutMs > 0 && time.Duration(req.TimeoutMs)*time.Millisecond <= proxyMaxTimeout {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	defer cancel()
	outReq = outReq.WithContext(ctx)

	started := time.Now()
	resp, err := h.client().Do(outReq)
	if err != nil {
		respondError(c, http.StatusBadGateway, 502, fmt.Sprintf("请求失败: %v", err))
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, proxyMaxResponseBytes+1))
	if err != nil {
		respondError(c, http.StatusBadGateway, 502, fmt.Sprintf("读取响应失败: %v", err))
		return
	}
	truncated := len(body) > proxyMaxResponseBytes
	if truncated {
		body = body[:proxyMaxResponseBytes]
	}

	headers := make(map[string]string, len(resp.Header))
	for k, vs := range resp.Header {
		headers[k] = strings.Join(vs, ", ")
	}

	data := gin.H{
		"status":    resp.StatusCode,
		"statusText": resp.Status,
		"headers":   headers,
		"size":      len(body),
		"truncated": truncated,
		"durationMs": time.Since(started).Milliseconds(),
	}
	// 文本响应直接回传，二进制回 base64（响应区自行判断展示方式）
	if utf8.Valid(body) && !bytes.ContainsRune(body, 0) {
		data["bodyText"] = string(body)
	} else {
		data["bodyBase64"] = base64.StdEncoding.EncodeToString(body)
	}
	respondOK(c, http.StatusOK, data)
}
