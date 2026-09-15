package agentHelper

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// Direct SQL access for the database explorer.
//
// The agent holds cluster credentials, so it reads the `<db>-dbcreds` secret and
// connects to Postgres itself. That avoids the pgweb pod entirely: no pod to
// create, no Service to proxy through, and nothing that depends on the caller
// being able to reach the pod network.

const (
	defaultMaxRows  = 1000
	queryTimeout    = 30 * time.Second
	poolIdleTimeout = 5 * time.Minute
	// Rows are stringified into a gRPC message capped at 4MB by default. Stop
	// well short of that so a wide table fails gracefully rather than exceeding
	// the transport limit.
	maxResultBytes = 3 << 20
)

var (
	sqlPoolMu sync.Mutex
	sqlPools  = map[string]*pgxpool.Pool{}
)

// sqlPool returns a pooled connection for a database, creating it on first use.
//
// Pooling matters here: the explorer issues a query per click, and dialling
// Aurora fresh each time is visibly slow.
func (a *Agent) sqlPool(ctx context.Context, namespace, dbName string) (*pgxpool.Pool, error) {
	key := namespace + "/" + dbName

	sqlPoolMu.Lock()
	if pool, ok := sqlPools[key]; ok {
		sqlPoolMu.Unlock()
		return pool, nil
	}
	sqlPoolMu.Unlock()

	// Reuse tunnelConfig rather than getClientConfig: the latter pre-sets
	// config.Transport, which client-go rejects alongside TLS options.
	clientset, err := tunnelClientset()
	if err != nil {
		return nil, fmt.Errorf("kubernetes client: %w", err)
	}

	secretName := fmt.Sprintf("%s-dbcreds", dbName)
	secret, err := clientset.CoreV1().Secrets(namespace).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("read %s/%s: %w", namespace, secretName, err)
	}

	field := func(k string) string { return string(secret.Data[k]) }
	host, port := field("host"), field("port")
	user, pass := field("username"), field("password")
	database := field("database")
	if host == "" || user == "" || database == "" {
		return nil, fmt.Errorf("secret %s is missing host/username/database", secretName)
	}
	if port == "" {
		port = "5432"
	}

	// Credentials stay inside the agent and are never returned or logged.
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=require",
		pgxEscape(user), pgxEscape(pass), host, port, database)

	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse connection config: %w", err)
	}
	cfg.MaxConns = 4
	cfg.MaxConnIdleTime = poolIdleTimeout

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}

	sqlPoolMu.Lock()
	// Another goroutine may have won the race while we were dialling.
	if existing, ok := sqlPools[key]; ok {
		sqlPoolMu.Unlock()
		pool.Close()
		return existing, nil
	}
	sqlPools[key] = pool
	sqlPoolMu.Unlock()

	log.Info().Str("db", key).Str("host", host).Msg("[sql] connected")
	return pool, nil
}

// pgxEscape percent-encodes the characters that would otherwise break a DSN.
func pgxEscape(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch r {
		case ':', '/', '?', '#', '[', ']', '@', '%', ' ':
			out = append(out, []rune(fmt.Sprintf("%%%02X", r))...)
		default:
			out = append(out, r)
		}
	}
	return string(out)
}

// handleSqlQuery runs a query and returns the result over the gRPC stream.
func (a *Agent) handleSqlQuery(req *pb.SqlQueryRequest) {
	started := time.Now()
	streamID := req.GetStreamId()

	resp := &pb.SqlQueryResponse{StreamId: streamID}
	defer func() {
		resp.DurationMs = time.Since(started).Milliseconds()
		if err := a.sendMessage(&pb.AgentMessage{
			Message: &pb.AgentMessage_SqlQueryResponse{SqlQueryResponse: resp},
		}); err != nil {
			log.Warn().Err(err).Str("stream_id", streamID).Msg("[sql] failed to send response")
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()

	ns := req.GetNamespace()
	if ns == "" {
		ns = "default"
	}

	pool, err := a.sqlPool(ctx, ns, req.GetDbName())
	if err != nil {
		resp.Error = err.Error()
		return
	}

	maxRows := int(req.GetMaxRows())
	if maxRows <= 0 {
		maxRows = defaultMaxRows
	}

	conn, err := pool.Acquire(ctx)
	if err != nil {
		resp.Error = fmt.Sprintf("acquire connection: %v", err)
		return
	}
	defer conn.Release()

	// Unless writes are explicitly allowed, run inside a read-only transaction.
	// This is enforced by Postgres rather than by the UI, so a DROP cannot slip
	// through from a caller that skips the frontend.
	var tx pgx.Tx
	if !req.GetAllowWrite() {
		tx, err = conn.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			resp.Error = fmt.Sprintf("begin read-only transaction: %v", err)
			return
		}
		defer tx.Rollback(ctx)
	}

	var rows pgx.Rows
	if tx != nil {
		rows, err = tx.Query(ctx, req.GetSql())
	} else {
		rows, err = conn.Query(ctx, req.GetSql())
	}
	if err != nil {
		resp.Error = pgError(err)
		return
	}
	defer rows.Close()

	for _, fd := range rows.FieldDescriptions() {
		resp.Columns = append(resp.Columns, &pb.SqlColumn{
			Name: fd.Name,
			Type: pgTypeName(conn.Conn(), fd.DataTypeOID),
		})
	}

	bytesUsed := 0
	for rows.Next() {
		if len(resp.Rows) >= maxRows {
			resp.Truncated = true
			break
		}
		values, err := rows.Values()
		if err != nil {
			resp.Error = fmt.Sprintf("read row: %v", err)
			return
		}

		row := &pb.SqlRow{
			Values: make([]string, len(values)),
			Nulls:  make([]bool, len(values)),
		}
		for i, v := range values {
			if v == nil {
				row.Nulls[i] = true
				continue
			}
			s := formatValue(v)
			row.Values[i] = s
			bytesUsed += len(s)
		}
		resp.Rows = append(resp.Rows, row)

		// Guard the transport limit independently of the row cap: a few very wide
		// rows can exceed it long before maxRows is reached.
		if bytesUsed > maxResultBytes {
			resp.Truncated = true
			break
		}
	}
	if err := rows.Err(); err != nil {
		resp.Error = pgError(err)
		return
	}

	resp.RowsAffected = rows.CommandTag().RowsAffected()
	log.Info().
		Str("db", ns+"/"+req.GetDbName()).
		Int("rows", len(resp.Rows)).
		Bool("truncated", resp.Truncated).
		Msg("[sql] query complete")
}

// formatValue stringifies a scanned value for transport.
func formatValue(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	case time.Time:
		return t.Format(time.RFC3339Nano)
	case bool:
		return strconv.FormatBool(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case int32:
		return strconv.FormatInt(int64(t), 10)
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(t), 'f', -1, 32)
	}

	// pgx returns NUMERIC, JSON and similar as struct types that would otherwise
	// stringify as Go struct dumps ("{956 -1 false finite true}"). Prefer their
	// text encoding, which is what the value actually looks like in SQL.
	switch t := v.(type) {
	case pgtype.Numeric:
		if s, err := t.Value(); err == nil && s != nil {
			return fmt.Sprintf("%v", s)
		}
	case interface{ Value() (driver.Value, error) }:
		if s, err := t.Value(); err == nil && s != nil {
			return fmt.Sprintf("%v", s)
		}
	case fmt.Stringer:
		return t.String()
	case map[string]any, []any:
		if b, err := json.Marshal(t); err == nil {
			return string(b)
		}
	}
	return fmt.Sprintf("%v", v)
}

// pgTypeName resolves an OID to a readable type name, falling back to the OID.
func pgTypeName(conn *pgx.Conn, oid uint32) string {
	if conn != nil {
		if t, ok := conn.TypeMap().TypeForOID(oid); ok {
			return t.Name
		}
	}
	return fmt.Sprintf("oid:%d", oid)
}

// pgError surfaces the database's own message, which is far more useful than a
// wrapped driver error ("column x does not exist" vs "query failed"). Postgres
// also supplies a position and hint for syntax errors, which are worth keeping.
func pgError(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		msg := pgErr.Message
		if pgErr.Detail != "" {
			msg += ": " + pgErr.Detail
		}
		if pgErr.Hint != "" {
			msg += " (hint: " + pgErr.Hint + ")"
		}
		return msg
	}
	return err.Error()
}
