// Package envtest holds test doubles for the environment registry.
package envtest

import (
	"bytes"
	"context"
	"io"
	"sort"
	"strings"
	"sync"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// MemS3 is an in-memory S3 for tests of code built on the registry.
type MemS3 struct {
	mu      sync.Mutex
	Objects map[string][]byte
}

func NewMemS3() *MemS3 { return &MemS3{Objects: map[string][]byte{}} }

func (m *MemS3) GetObject(_ context.Context, in *s3.GetObjectInput, _ ...func(*s3.Options)) (*s3.GetObjectOutput, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	b, ok := m.Objects[*in.Key]
	if !ok {
		return nil, &s3types.NoSuchKey{}
	}
	return &s3.GetObjectOutput{Body: io.NopCloser(bytes.NewReader(b))}, nil
}

func (m *MemS3) PutObject(_ context.Context, in *s3.PutObjectInput, _ ...func(*s3.Options)) (*s3.PutObjectOutput, error) {
	b, _ := io.ReadAll(in.Body)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Objects[*in.Key] = b
	return &s3.PutObjectOutput{}, nil
}

func (m *MemS3) ListObjectsV2(_ context.Context, in *s3.ListObjectsV2Input, _ ...func(*s3.Options)) (*s3.ListObjectsV2Output, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	prefix := awssdk.ToString(in.Prefix)
	delim := awssdk.ToString(in.Delimiter)
	out := &s3.ListObjectsV2Output{IsTruncated: awssdk.Bool(false)}
	seen := map[string]bool{}
	var keys []string
	for k := range m.Objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !strings.HasPrefix(k, prefix) {
			continue
		}
		rest := strings.TrimPrefix(k, prefix)
		if delim != "" {
			if i := strings.Index(rest, delim); i >= 0 {
				p := prefix + rest[:i+1]
				if !seen[p] {
					seen[p] = true
					out.CommonPrefixes = append(out.CommonPrefixes, s3types.CommonPrefix{Prefix: awssdk.String(p)})
				}
				continue
			}
		}
		out.Contents = append(out.Contents, s3types.Object{Key: awssdk.String(k)})
	}
	return out, nil
}
