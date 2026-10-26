package porttest

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
)

// SocketIO fakes the Socket.IO setup/login events of Uptime Kuma and Dockge
// over Engine.IO long-polling, one session at a time.
type SocketIO struct {
	mu       sync.Mutex
	User     string
	Password string
	queue    chan string
}

func NewSocketIO(user, password string) *SocketIO {
	return &SocketIO{User: user, Password: password, queue: make(chan string, 16)}
}

func (s *SocketIO) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("app")) })
	mux.HandleFunc("/socket.io/", s.serve)
	return mux
}

func (s *SocketIO) serve(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		body, _ := io.ReadAll(r.Body)
		s.receive(string(body))
		w.Write([]byte("ok"))
		return
	}
	if r.URL.Query().Get("sid") == "" {
		w.Write([]byte(`0{"sid":"fake"}`))
		return
	}
	select {
	case packets := <-s.queue:
		w.Write([]byte(packets))
	case <-r.Context().Done():
	}
}

func (s *SocketIO) receive(packet string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case packet == "40":
		packets := []string{`40{"sid":"fake"}`, `42["info",{}]`}
		if s.User == "" {
			packets = append(packets, `42["setup"]`)
		}
		s.queue <- strings.Join(packets, "\x1e")
	case strings.HasPrefix(packet, "42"):
		rest := packet[2:]
		end := strings.IndexByte(rest, '[')
		var args []json.RawMessage
		if end < 0 || json.Unmarshal([]byte(rest[end:]), &args) != nil || len(args) == 0 {
			return
		}
		var event string
		json.Unmarshal(args[0], &event)
		ack := map[string]any{"ok": false, "msg": "unknown event"}
		switch event {
		case "setup":
			var user, password string
			json.Unmarshal(args[1], &user)
			json.Unmarshal(args[2], &password)
			if s.User != "" {
				ack = map[string]any{"ok": false, "msg": "already initialized"}
				break
			}
			s.User, s.Password = user, password
			ack = map[string]any{"ok": true}
		case "login":
			var login struct{ Username, Password string }
			json.Unmarshal(args[1], &login)
			ack = map[string]any{"ok": false, "msg": "Incorrect username or password."}
			if s.User != "" && login.Username == s.User && login.Password == s.Password {
				ack = map[string]any{"ok": true, "token": "fixture-token"}
			}
		}
		data, _ := json.Marshal(ack)
		s.queue <- "43" + rest[:end] + "[" + string(data) + "]"
	case packet == "1":
		for len(s.queue) > 0 {
			<-s.queue
		}
	}
}
