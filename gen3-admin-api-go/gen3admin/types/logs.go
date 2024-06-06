package types

import "time"

type LogMessage struct {
	Message   string    `json:"message"`
	Type      string    `json:"type"`
	Pod       string    `json:"pod"`
	Container string    `json:"container"`
	Unix      int64     `json:"unix"`
	Timestamp time.Time `json:"timestamp"`
	Namespace string    `json:"namespace"`
}
