package pods

import (
	"bufio"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/uc-cdis/gen3-admin/gen3admin/config"
	"github.com/uc-cdis/gen3-admin/gen3admin/types"
	"go.uber.org/zap"
	v1 "k8s.io/api/core/v1"
)

func GetLogs(namespace, pod string, container string, ctx context.Context, ch chan types.LogMessage, errCh chan error, done chan struct{}) error {

	client, _, err := config.K8sClient()
	if err != nil {
		return err
	}

	// Get logs of pods
	tailLines := int64(5000) // we don`t need more then 5000 logs. If more is required then use grafana
	podLogOpts := v1.PodLogOptions{
		Container:  container,
		Follow:     false,
		Timestamps: true, // include timestamps
		TailLines:  &tailLines,
	}

	podLogRequest := client.CoreV1().Pods(namespace).GetLogs(pod, &podLogOpts)

	stream, err := podLogRequest.Stream(ctx)
	if err != nil {
		return err
	}
	defer stream.Close()

	// reading logs with scanner, line by line
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		select {
		case <-done:
			fmt.Println("done")
			return nil
		default:
			text := scanner.Text()
			parts := strings.SplitN(text, "Z", 2) // the date ends with a Z, so we will split it there!

			timestamp, err := time.Parse(time.RFC3339Nano, fmt.Sprintf("%sZ", parts[0]))
			if err != nil {
				zap.L().Info("Error parsing timestamp ", zap.Error(err))
				return fmt.Errorf("error parsing timestamp: %v", err)
			}
			// forward to other channel.
			message := strings.TrimSpace(parts[1])

			ch <- types.LogMessage{
				Type:      "log",
				Timestamp: timestamp,
				Pod:       pod,
				Container: container,
				Message:   message,
				Unix:      timestamp.Unix(),
				Namespace: namespace,
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("error while scanning log stream: %w", err)
	}

	return nil

}
