package runner

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os/exec"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type CommandRequest struct {
	Command string   `json:"cmd"`
	Args    []string `json:"args"`
}

type ExecutionStatus string

const (
	StatusRunning  ExecutionStatus = "running"
	StatusComplete ExecutionStatus = "complete"
	StatusError    ExecutionStatus = "error"
)

type Execution struct {
	ID          string          `json:"id"`
	Command     string          `json:"command"`
	Args        []string        `json:"args"`
	Status      ExecutionStatus `json:"status"`
	Output      []string        `json:"output"`
	Error       string          `json:"error,omitempty"`
	ErrorOutput []string        `json:"error_output,omitempty"`
	StartTime   time.Time       `json:"start_time"`
	EndTime     *time.Time      `json:"end_time,omitempty"`
	cmd         *exec.Cmd
	mu          sync.Mutex
}

type ExecutionStore struct {
	executions map[string]*Execution
	mu         sync.RWMutex
}

func NewExecutionStore() *ExecutionStore {
	return &ExecutionStore{
		executions: make(map[string]*Execution),
	}
}

func (s *ExecutionStore) Add(exec *Execution) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.executions[exec.ID] = exec
}

func (s *ExecutionStore) Get(id string) (*Execution, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	exec, exists := s.executions[id]
	return exec, exists
}

func (s *ExecutionStore) List() []*Execution {
	s.mu.RLock()
	defer s.mu.RUnlock()
	execs := make([]*Execution, 0, len(s.executions))
	for _, exec := range s.executions {
		execs = append(execs, exec)
	}
	return execs
}

// Execution helper methods
func (e *Execution) appendOutput(line string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Output = append(e.Output, line)
}

// Set erroroutput
func (e *Execution) appendErrorOutput(line string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.ErrorOutput = append(e.ErrorOutput, line)
}

func (e *Execution) setError(err error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Status = StatusError
	e.Error = err.Error()
	now := time.Now()
	e.EndTime = &now
}

func (e *Execution) setCmd(cmd *exec.Cmd) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.cmd = cmd
}

func (e *Execution) complete() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.Status = StatusComplete
	now := time.Now()
	e.EndTime = &now
}

// Add this method to the Execution struct
func (e *Execution) terminate() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.Status != StatusRunning {
		return fmt.Errorf("execution not running")
	}

	// Kill it:
	if err := e.cmd.Process.Kill(); err != nil {
		log.Fatal("failed to kill process: ", err)
	}

	e.Status = StatusComplete
	now := time.Now()
	e.EndTime = &now
	return nil
}

func Runner(c *gin.Context) {
	var cmdReq CommandRequest
	if err := c.BindJSON(&cmdReq); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}

	cmd := exec.Command(cmdReq.Command, cmdReq.Args...)

	// Get pipe to stdout
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	// Start command
	if err := cmd.Start(); err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	scanner := bufio.NewScanner(stdout)
	errorScanner := bufio.NewScanner(stderr)

	// Stream errors
	go func() {
		for errorScanner.Scan() {
			text := errorScanner.Text()
			c.SSEvent("error", text)
			c.Writer.Flush()
		}
	}()

	// Stream in goroutine
	go func() {
		for scanner.Scan() {
			text := scanner.Text()
			// Write to response with SSE format
			c.SSEvent("message", text)
			c.Writer.Flush()
		}
	}()

	// Wait for command to finish
	if err := cmd.Wait(); err != nil {
		c.SSEvent("error", err.Error())
		return
	}
}

func executeCommand(ex *Execution) {
	// ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cmd := exec.CommandContext(ctx, ex.Command, ex.Args...)

	ex.setCmd(cmd)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		ex.setError(err)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		ex.setError(err)
		return
	}

	if err := cmd.Start(); err != nil {
		ex.setError(err)
		return
	}

	go func() {
		<-ctx.Done()
		if ctx.Err() == context.DeadlineExceeded {
			ex.setError(fmt.Errorf("execution timed out after 30 seconds"))
			// On timeout, try to kill the process
			cmd.Process.Kill()
		}
	}()

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		ex.appendOutput(scanner.Text())
	}

	scanner = bufio.NewScanner(stderr)
	for scanner.Scan() {
		ex.appendOutput(scanner.Text())
	}

	if err := cmd.Wait(); err != nil {
		ex.setError(err)
		return
	}

	ex.complete()
}

func HandleExecute(store *ExecutionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var cmdReq CommandRequest
		if err := c.BindJSON(&cmdReq); err != nil {
			c.JSON(400, gin.H{"error": err.Error()})
			return
		}

		// Create new execution
		execID := uuid.New().String()
		execution := &Execution{
			ID:        execID,
			Command:   cmdReq.Command,
			Args:      cmdReq.Args,
			Status:    StatusRunning,
			Output:    make([]string, 0),
			StartTime: time.Now(),
		}
		store.Add(execution)

		// Start command execution in goroutine
		go executeCommand(execution)

		// Return the execution ID immediately
		c.JSON(202, gin.H{
			"id":      execID,
			"message": "Command execution started",
		})
	}
}

func HandleGetExecution(store *ExecutionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")
		exec, exists := store.Get(execID)
		if !exists {
			c.JSON(404, gin.H{"error": "Execution not found"})
			return
		}

		// Set HTTP status based on execution status
		status := 200
		switch exec.Status {
		case StatusRunning:
			status = 202
		case StatusError:
			status = 500
		case StatusComplete:
			status = 200
		}

		c.JSON(status, exec)
	}
}

func HandleStreamExecution(store *ExecutionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")
		exec, exists := store.Get(execID)
		if !exists {
			c.JSON(404, gin.H{"error": "Execution not found"})
			return
		}

		// Set streaming headers
		c.Writer.Header().Set("Content-Type", "text/event-stream")
		c.Writer.Header().Set("Cache-Control", "no-cache")
		c.Writer.Header().Set("Connection", "keep-alive")
		c.Writer.Header().Set("Transfer-Encoding", "chunked")

		// Stream existing output
		lastIndex := 0
		for {
			exec.mu.Lock()

			// First check if process has ended
			if exec.Status != StatusRunning {
				// Send any remaining output
				currentLen := len(exec.Output)
				for i := lastIndex; i < currentLen; i++ {
					c.SSEvent("message", exec.Output[i])
				}

				// Send final status
				if exec.Status == StatusError {
					c.SSEvent("error", exec.Error)
				} else {
					c.SSEvent("done", "completed")
				}
				c.Writer.Flush()
				exec.mu.Unlock()
				return // End the connection
			}

			currentLen := len(exec.Output)
			// Send any new output
			for i := lastIndex; i < currentLen; i++ {
				c.SSEvent("message", exec.Output[i])
				c.Writer.Flush()
			}
			lastIndex = currentLen

			// Check if execution is complete
			if exec.Status != StatusRunning {
				if exec.Status == StatusError {
					c.SSEvent("error", exec.Error)
				}
				c.SSEvent("done", exec.Status)
				exec.mu.Unlock()
				return
			}
			exec.mu.Unlock()

			time.Sleep(100 * time.Millisecond)
		}
	}
}

func HandleListExecutions(store *ExecutionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		executions := store.List()
		c.JSON(200, executions)
	}
}

func HandleTerminate(store *ExecutionStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		execID := c.Param("id")
		exec, exists := store.Get(execID)
		if !exists {
			c.JSON(404, gin.H{"error": "Execution not found"})
			return
		}

		if err := exec.terminate(); err != nil {
			c.JSON(500, gin.H{"error": err.Error()})
			return
		}

		c.JSON(200, gin.H{"message": "Execution terminated"})
	}
}
