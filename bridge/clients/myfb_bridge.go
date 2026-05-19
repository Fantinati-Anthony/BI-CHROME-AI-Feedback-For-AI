// Package myfbbridge — minimal Go client for the My-Feedbacks DB Bridge.
//
// Mirror of the JS client (sidepanel/db-bridge-client.js) and the
// Python client (bridge/clients/myfb_bridge.py). Same HMAC math, same
// canonical-args quirk for PHP compat (empty args serialize to "[]",
// not "{}"), same humanized errors.
//
// Standard library only — no third-party deps.
//
// Usage :
//
//	bc := myfbbridge.New("https://example.com/myfb-bridge.php", os.Getenv("BRIDGE_SECRET"))
//	meta, err := bc.Meta(context.Background())
//	if err != nil { log.Fatal(err) }
//	fmt.Println(meta["tableCount"])
package myfbbridge

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// MinBridgeVersion is the oldest bridge build this client knows how to talk to.
const MinBridgeVersion = "1.1.0"

// Client signs requests and talks to the bridge over HTTP.
type Client struct {
	URL     string
	Secret  string
	Timeout time.Duration // default 10s
	HTTP    *http.Client  // optional override
}

// New constructs a Client with sensible defaults.
func New(url, secret string) *Client {
	return &Client{URL: url, Secret: secret, Timeout: 10 * time.Second}
}

// ── Signing ───────────────────────────────────────────────────────────

// canonArgs mirrors PHP's json_encode($args, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE).
// Empty map → "[]" (PHP encodes an empty assoc as a JSON array). Otherwise
// json.Marshal with default settings — same byte output as Python's
// json.dumps(..., separators=(",", ":")).
func canonArgs(args map[string]any) (string, error) {
	if len(args) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(args)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (c *Client) sign(ts int64, nonce, op string, args map[string]any) (string, error) {
	canon, err := canonArgs(args)
	if err != nil {
		return "", err
	}
	msg := strconv.FormatInt(ts, 10) + "." + nonce + "." + op + "." + canon
	m := hmac.New(sha256.New, []byte(c.Secret))
	m.Write([]byte(msg))
	return hex.EncodeToString(m.Sum(nil)), nil
}

func randomNonce() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}

// ── Transport ─────────────────────────────────────────────────────────

type bridgeResponse struct {
	OK      bool            `json:"ok"`
	Data    json.RawMessage `json:"data,omitempty"`
	Error   string          `json:"error,omitempty"`
	Version string          `json:"version,omitempty"`
}

// Call posts a signed body to the bridge and unmarshals data into out.
// out may be nil if the caller doesn't care about the response payload.
func (c *Client) Call(ctx context.Context, op string, args map[string]any, out any) error {
	if c.URL == "" || c.Secret == "" {
		return errors.New("bridge non configuré (URL et secret requis)")
	}
	ts := time.Now().Unix()
	nonce, err := randomNonce()
	if err != nil {
		return err
	}
	if args == nil {
		args = map[string]any{}
	}
	sig, err := c.sign(ts, nonce, op, args)
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]any{
		"op": op, "args": args, "ts": ts, "nonce": nonce, "sig": sig,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: c.Timeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New(humanize(0, err.Error()))
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	var parsed bridgeResponse
	if jsonErr := json.Unmarshal(raw, &parsed); jsonErr != nil {
		return errors.New(humanize(resp.StatusCode, "malformed json"))
	}
	if v := parsed.Version; v != "" && cmpVer(v, MinBridgeVersion) < 0 {
		return fmt.Errorf("Bridge trop ancien (%s < %s) — mets à jour myfb-bridge.php", v, MinBridgeVersion)
	}
	if !parsed.OK {
		return errors.New(humanize(resp.StatusCode, parsed.Error))
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(parsed.Data, out)
}

// ── Error humanization ────────────────────────────────────────────────

func humanize(status int, raw string) string {
	r := strings.ToLower(raw)
	switch {
	case status == 0:
		return "Bridge inaccessible (réseau / DNS / CORS)"
	case status == 404:
		return "Endpoint introuvable — vérifie l'URL du bridge"
	case status == 401 && strings.Contains(r, "replay"):
		return "Nonce déjà utilisé — horloge décalée ?"
	case status == 401 && strings.Contains(r, "stale"):
		return "Horloge client/serveur décalée (> 60s)"
	case status == 401 && strings.Contains(r, "nonce"):
		return "Nonce invalide"
	case status == 401:
		return "Signature HMAC invalide — secret incorrect ?"
	case status == 403:
		return "Table non exposée par la config du bridge"
	case status == 405:
		return "Méthode HTTP refusée — bridge mal configuré"
	case status >= 500:
		return "Erreur interne du bridge — vérifie audit.log"
	default:
		if raw != "" {
			return raw
		}
		return fmt.Sprintf("Erreur HTTP %d", status)
	}
}

// cmpVer compares semver-ish strings. Returns -1, 0, or 1.
func cmpVer(a, b string) int {
	pa := splitVer(a)
	pb := splitVer(b)
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var va, vb int
		if i < len(pa) {
			va = pa[i]
		}
		if i < len(pb) {
			vb = pb[i]
		}
		if va < vb {
			return -1
		}
		if va > vb {
			return 1
		}
	}
	return 0
}

func splitVer(s string) []int {
	if s == "" {
		return []int{0}
	}
	parts := strings.Split(s, ".")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		n, _ := strconv.Atoi(p)
		out = append(out, n)
	}
	return out
}

// ── Convenience operations ────────────────────────────────────────────

// Meta returns driver, version, table count, total rows, total bytes.
func (c *Client) Meta(ctx context.Context) (map[string]any, error) {
	out := map[string]any{}
	return out, c.Call(ctx, "meta", nil, &out)
}

// Tables returns the list of exposed tables with stats.
func (c *Client) Tables(ctx context.Context) ([]map[string]any, error) {
	var out struct {
		Tables []map[string]any `json:"tables"`
	}
	if err := c.Call(ctx, "tables", nil, &out); err != nil {
		return nil, err
	}
	return out.Tables, nil
}

// Describe returns columns of a single table.
func (c *Client) Describe(ctx context.Context, table string) ([]map[string]any, error) {
	var out struct {
		Columns []map[string]any `json:"columns"`
	}
	if err := c.Call(ctx, "describe", map[string]any{"table": table}, &out); err != nil {
		return nil, err
	}
	return out.Columns, nil
}

// Count returns the row count of a single table.
func (c *Client) Count(ctx context.Context, table string) (int, error) {
	var out struct {
		Count int `json:"count"`
	}
	if err := c.Call(ctx, "count", map[string]any{"table": table}, &out); err != nil {
		return 0, err
	}
	return out.Count, nil
}

// SchemaMd returns the full schema as Markdown — useful as AI context.
func (c *Client) SchemaMd(ctx context.Context) (string, error) {
	var out struct {
		Markdown string `json:"markdown"`
	}
	if err := c.Call(ctx, "schema_md", nil, &out); err != nil {
		return "", err
	}
	return out.Markdown, nil
}
