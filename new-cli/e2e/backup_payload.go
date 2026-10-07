package e2e

import (
	"bytes"
	"encoding/json"
	"io"
)

type notificationPayload struct {
	ID      string `json:"id"`
	Message string `json:"message"`
	Event   string `json:"event"`
}

func exactRestoredNotification(stream []byte, id, message string) bool {
	decoder := json.NewDecoder(bytes.NewReader(stream))
	found := false
	for {
		var item notificationPayload
		err := decoder.Decode(&item)
		if err == io.EOF {
			return found
		}
		if err != nil {
			return false
		}
		if item.Event == "message" && item.ID == id && item.Message == message {
			found = true
		}
	}
}
