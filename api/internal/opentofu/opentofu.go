// main.go
package opentofu

import (
	"context"
	"fmt"
	"log"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/hashicorp/go-getter"
	"github.com/hashicorp/terraform-exec/tfexec"
)

type ModuleRequest struct {
	GitURL string `json:"git_url"`
}

func main() {
	r := gin.Default()

	r.POST("/run-module", func(c *gin.Context) {
		var req ModuleRequest
		if err := c.BindJSON(&req); err != nil {
			c.JSON(400, gin.H{"error": "Invalid request body"})
			return
		}

		// Set up SSE
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("Transfer-Encoding", "chunked")

		// Create a channel for messages
		messageChan := make(chan string)
		defer close(messageChan)

		// Start processing in a goroutine
		go func() {
			workingDir := filepath.Join("modules", "temp")

			// Use go-getter to clone the repository
			// This handles Git, HTTP, S3, and other sources
			err := getter.Get(workingDir, req.GitURL, getter.WithProgress(func(progress float64) {
				// progress*100)
				messageChan <- fmt.Sprintf("Download progress: %.2f%%", progress*100)
			}))

			if err != nil {
				messageChan <- fmt.Sprintf("Error cloning repository: %v", err)
				return
			}

			// Find OpenTofu executable
			tfpath, err := tfexec.Find()
			if err != nil {
				messageChan <- fmt.Sprintf("Error finding OpenTofu: %v", err)
				return
			}

			// Create OpenTofu instance
			tf, err := tfexec.NewTerraform(workingDir, tfpath)
			if err != nil {
				messageChan <- fmt.Sprintf("Error creating OpenTofu instance: %v", err)
				return
			}

			// Set up logging
			tf.SetStdout(WriterFunc(func(p []byte) (n int, err error) {
				messageChan <- string(p)
				return len(p), nil
			}))

			// Initialize OpenTofu
			messageChan <- "Initializing OpenTofu..."
			err = tf.Init(context.Background(), tfexec.Upgrade(true))
			if err != nil {
				messageChan <- fmt.Sprintf("Error initializing: %v", err)
				return
			}

			// Show plan
			messageChan <- "Creating plan..."
			plan, err := tf.Plan(context.Background())
			if err != nil {
				messageChan <- fmt.Sprintf("Error creating plan: %v", err)
				return
			}
			messageChan <- fmt.Sprintf("Plan created: %v", plan)

			// Apply
			messageChan <- "Applying changes..."
			err = tf.Apply(context.Background())
			if err != nil {
				messageChan <- fmt.Sprintf("Error applying: %v", err)
				return
			}

			// Get outputs
			outputs, err := tf.Output(context.Background())
			if err != nil {
				messageChan <- fmt.Sprintf("Error getting outputs: %v", err)
				return
			}

			for k, v := range outputs {
				messageChan <- fmt.Sprintf("Output %s: %v", k, v)
			}
		}()

		// Stream messages to client
		for message := range messageChan {
			c.SSEvent("message", message)
			c.Writer.Flush()
		}
	})

	log.Fatal(r.Run(":8080"))
}

// WriterFunc is a type that implements io.Writer
type WriterFunc func(p []byte) (n int, err error)

func (f WriterFunc) Write(p []byte) (n int, err error) {
	return f(p)
}
