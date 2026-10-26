package helpers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const socketIOPath = "/socket.io/?EIO=4&transport=polling"

// SocketIO is a minimal Socket.IO v4 client over Engine.IO long-polling, for
// Apps whose only setup or login API is a Socket.IO event. It is sequential:
// one request at a time, one session per client.
type SocketIO struct {
	h       *H
	sid     string
	nextAck int
	acks    map[int]json.RawMessage
	events  map[string]bool
	pong    bool
	opened  bool
}

// SocketIOConnect opens a Socket.IO session on the App's default namespace.
func (h *H) SocketIOConnect(ctx context.Context) (*SocketIO, error) {
	resp, err := h.HTTP(ctx, Request{Path: socketIOPath})
	if err != nil {
		return nil, err
	}
	if resp.Status != http.StatusOK {
		return nil, fmt.Errorf("%s Socket.IO handshake returned HTTP %d", h.App, resp.Status)
	}
	body := strings.TrimPrefix(string(resp.Body), "0")
	var open struct {
		SID string `json:"sid"`
	}
	if err := json.Unmarshal([]byte(body), &open); err != nil || open.SID == "" {
		return nil, fmt.Errorf("%s did not answer the Socket.IO handshake", h.App)
	}
	c := &SocketIO{h: h, sid: open.SID, acks: map[int]json.RawMessage{}, events: map[string]bool{}}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	if err := c.send(ctx, "40"); err != nil {
		return nil, err
	}
	for !c.opened {
		if err := c.poll(ctx); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func (c *SocketIO) path() string { return socketIOPath + "&sid=" + c.sid }

func (c *SocketIO) send(ctx context.Context, payload string) error {
	resp, err := c.h.HTTP(ctx, Request{
		Method: http.MethodPost, Path: c.path(), Body: []byte(payload),
		Header: map[string]string{"Content-Type": "text/plain;charset=UTF-8"},
	})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("%s Socket.IO send returned HTTP %d", c.h.App, resp.Status)
	}
	return nil
}

func (c *SocketIO) poll(ctx context.Context) error {
	if c.pong {
		c.pong = false
		if err := c.send(ctx, "3"); err != nil {
			return err
		}
	}
	resp, err := c.h.HTTP(ctx, Request{Path: c.path()})
	if err != nil {
		return err
	}
	if resp.Status != http.StatusOK {
		return fmt.Errorf("%s Socket.IO poll returned HTTP %d", c.h.App, resp.Status)
	}
	for _, packet := range strings.Split(string(resp.Body), "\x1e") {
		if err := c.handle(packet); err != nil {
			return err
		}
	}
	return nil
}

func (c *SocketIO) handle(packet string) error {
	switch {
	case packet == "2":
		c.pong = true
	case packet == "1":
		return fmt.Errorf("%s closed the Socket.IO session", c.h.App)
	case strings.HasPrefix(packet, "40"):
		c.opened = true
	case strings.HasPrefix(packet, "44"):
		return fmt.Errorf("%s refused the Socket.IO connection", c.h.App)
	case strings.HasPrefix(packet, "43"):
		rest := packet[2:]
		end := strings.IndexByte(rest, '[')
		if end < 1 {
			return nil
		}
		id, err := strconv.Atoi(rest[:end])
		if err != nil {
			return nil
		}
		c.acks[id] = json.RawMessage(rest[end:])
	case strings.HasPrefix(packet, "42"):
		rest := strings.TrimLeft(packet[2:], "0123456789")
		var event []json.RawMessage
		if json.Unmarshal([]byte(rest), &event) != nil || len(event) == 0 {
			return nil
		}
		var name string
		if json.Unmarshal(event[0], &name) == nil {
			c.events[name] = true
		}
	}
	return nil
}

// Seen reports whether the server has emitted event.
func (c *SocketIO) Seen(event string) bool { return c.events[event] }

// Emit sends an event with arguments and returns the first argument of the
// server's acknowledgement.
func (c *SocketIO) Emit(ctx context.Context, event string, args ...any) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	c.nextAck++
	id := c.nextAck
	data, err := json.Marshal(append([]any{event}, args...))
	if err != nil {
		return nil, err
	}
	if err := c.send(ctx, "42"+strconv.Itoa(id)+string(data)); err != nil {
		return nil, err
	}
	for {
		if ack, found := c.acks[id]; found {
			var values []json.RawMessage
			if json.Unmarshal(ack, &values) != nil || len(values) == 0 {
				return nil, fmt.Errorf("%s sent an empty %s acknowledgement", c.h.App, event)
			}
			return values[0], nil
		}
		if err := c.poll(ctx); err != nil {
			return nil, err
		}
	}
}

// Until polls until the server has emitted any of events.
func (c *SocketIO) Until(ctx context.Context, events ...string) error {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for {
		for _, event := range events {
			if c.events[event] {
				return nil
			}
		}
		if err := c.poll(ctx); err != nil {
			return err
		}
	}
}

// Drain collects whatever else the server emits within d.
func (c *SocketIO) Drain(ctx context.Context, d time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, d)
	defer cancel()
	for {
		err := c.poll(ctx)
		if errors.Is(err, context.DeadlineExceeded) {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// Close ends the session; failures are irrelevant.
func (c *SocketIO) Close(ctx context.Context) { _ = c.send(ctx, "1") }

// SocketIOAck is the {ok, msg} acknowledgement louislam's apps return.
type SocketIOAck struct {
	OK            bool   `json:"ok"`
	Msg           string `json:"msg"`
	TokenRequired bool   `json:"tokenRequired"`
}

// SocketIOSetupPending reports whether the App still offers its first-run
// "setup" event, which Uptime Kuma and Dockge emit on every new connection
// until the first administrator exists, right next to their "info" event.
func (h *H) SocketIOSetupPending(ctx context.Context) (bool, error) {
	c, err := h.SocketIOConnect(ctx)
	if err != nil {
		return false, err
	}
	defer c.Close(ctx)
	if err := c.Until(ctx, "info", "setup"); err != nil {
		return false, err
	}
	if err := c.Drain(ctx, time.Second); err != nil {
		return false, err
	}
	return c.Seen("setup"), nil
}

// SocketIOCreateAdmin runs the App's "setup" event with the Admin login.
func (h *H) SocketIOCreateAdmin(ctx context.Context, user, password string) error {
	c, err := h.SocketIOConnect(ctx)
	if err != nil {
		return err
	}
	defer c.Close(ctx)
	raw, err := c.Emit(ctx, "setup", user, password)
	if err != nil {
		return err
	}
	var ack SocketIOAck
	if err := json.Unmarshal(raw, &ack); err != nil {
		return fmt.Errorf("%s sent an unreadable setup acknowledgement", h.App)
	}
	if !ack.OK {
		return fmt.Errorf("%s refused the first administrator: %s", h.App, ack.Msg)
	}
	return nil
}

// SocketIOLogin runs the App's "login" event. A wrong password is (false, nil);
// two-factor, rate limits and other refusals are errors.
func (h *H) SocketIOLogin(ctx context.Context, user, password string) (bool, error) {
	c, err := h.SocketIOConnect(ctx)
	if err != nil {
		return false, err
	}
	defer c.Close(ctx)
	raw, err := c.Emit(ctx, "login", map[string]string{"username": user, "password": password})
	if err != nil {
		return false, err
	}
	var ack SocketIOAck
	if err := json.Unmarshal(raw, &ack); err != nil {
		return false, fmt.Errorf("%s sent an unreadable login acknowledgement", h.App)
	}
	switch {
	case ack.OK:
		return true, nil
	case ack.TokenRequired:
		return false, errors.New(h.App + " asks for a two-factor token, which this CLI cannot verify")
	case strings.Contains(ack.Msg, "Incorrect"):
		return false, nil
	}
	return false, fmt.Errorf("%s refused the login: %s", h.App, ack.Msg)
}
