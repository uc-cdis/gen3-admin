package server

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	pb "github.com/uc-cdis/gen3-admin/internal/tunnel"
)

// SQL explorer endpoints.
//
// Queries are executed by the agent, which reads the `<db>-dbcreds` secret and
// connects to Postgres directly. Nothing here touches credentials, and there is
// no proxy pod involved -- unlike the pgweb path, this works regardless of
// whether the caller can reach the cluster's pod network.

// Slightly longer than the agent's own 30s query timeout, so the agent's error
// message wins rather than the server timing out first.
const sqlRequestTimeout = 35 * time.Second

// listTablesSQL enumerates user tables with cheap row estimates.
//
// reltuples is a planner statistic rather than an exact count, which is the
// point: COUNT(*) per table would scan every table just to draw a sidebar.
const listTablesSQL = `
SELECT n.nspname AS schema,
       c.relname AS name,
       CASE WHEN c.reltuples < 0 THEN 0 ELSE c.reltuples::bigint END AS row_estimate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname, c.relname
`

// runAgentQuery sends a query to the agent and waits for the matching response.
func runAgentQuery(agentName string, req *pb.SqlQueryRequest) (*pb.SqlQueryResponse, error) {
	agentsMutex.RLock()
	agent, exists := AgentConnections[agentName]
	agentsMutex.RUnlock()
	if !exists || !agent.agent.Connected {
		return nil, fmt.Errorf("agent not connected: %s", agentName)
	}

	streamID := uuid.New().String()
	req.StreamId = streamID
	respChan := make(chan *pb.SqlQueryResponse, 1)

	agent.mutex.Lock()
	agent.sqlResponses[streamID] = respChan
	agent.mutex.Unlock()

	defer func() {
		agent.mutex.Lock()
		delete(agent.sqlResponses, streamID)
		agent.mutex.Unlock()
	}()

	if err := agent.sendMessage(&pb.ServerMessage{
		Message: &pb.ServerMessage_SqlQueryRequest{SqlQueryRequest: req},
	}); err != nil {
		return nil, fmt.Errorf("failed to reach agent: %w", err)
	}

	select {
	case resp := <-respChan:
		return resp, nil
	case <-time.After(sqlRequestTimeout):
		return nil, fmt.Errorf("timed out waiting for query result")
	}
}

// sqlResponseJSON shapes a response for the browser.
func sqlResponseJSON(resp *pb.SqlQueryResponse) gin.H {
	columns := make([]gin.H, 0, len(resp.Columns))
	for _, c := range resp.Columns {
		columns = append(columns, gin.H{"name": c.Name, "type": c.Type})
	}

	// NULL is sent as a nil entry rather than "" so the UI can distinguish it
	// from an empty string.
	rows := make([][]any, 0, len(resp.Rows))
	for _, r := range resp.Rows {
		row := make([]any, len(r.Values))
		for i, v := range r.Values {
			if i < len(r.Nulls) && r.Nulls[i] {
				row[i] = nil
				continue
			}
			row[i] = v
		}
		rows = append(rows, row)
	}

	return gin.H{
		"columns":      columns,
		"rows":         rows,
		"rowsAffected": resp.RowsAffected,
		"truncated":    resp.Truncated,
		"durationMs":   resp.DurationMs,
		"error":        resp.Error,
	}
}

// HandleSqlQuery runs an arbitrary query supplied by the caller.
func HandleSqlQuery(c *gin.Context) {
	var body struct {
		SQL        string `json:"sql"`
		MaxRows    int32  `json:"maxRows"`
		AllowWrite bool   `json:"allowWrite"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}
	if body.SQL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sql is required"})
		return
	}

	resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
		Namespace:  c.Param("namespace"),
		DbName:     c.Param("db"),
		Sql:        body.SQL,
		MaxRows:    body.MaxRows,
		AllowWrite: body.AllowWrite,
	})
	if err != nil {
		log.Warn().Err(err).Msg("SQL query failed")
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	// A query error (bad syntax, missing column) is a valid 200 response carrying
	// the database's message -- the request itself succeeded.
	c.JSON(http.StatusOK, sqlResponseJSON(resp))
}

// HandleSqlTables lists tables so the sidebar doesn't have to compose SQL.
func HandleSqlTables(c *gin.Context) {
	resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
		Namespace: c.Param("namespace"),
		DbName:    c.Param("db"),
		Sql:       listTablesSQL,
		MaxRows:   5000,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if resp.Error != "" {
		c.JSON(http.StatusOK, gin.H{"error": resp.Error})
		return
	}

	tables := make([]gin.H, 0, len(resp.Rows))
	for _, r := range resp.Rows {
		if len(r.Values) < 3 {
			continue
		}
		tables = append(tables, gin.H{
			"schema":      r.Values[0],
			"name":        r.Values[1],
			"rowEstimate": r.Values[2],
		})
	}
	c.JSON(http.StatusOK, gin.H{"tables": tables})
}

// HandleSqlDiagnosticsList returns the catalogue, marking entries whose required
// extension is unavailable so the UI can disable rather than fail them.
func HandleSqlDiagnosticsList(c *gin.Context) {
	installed := map[string]bool{}
	resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
		Namespace: c.Param("namespace"),
		DbName:    c.Param("db"),
		Sql:       extensionCheckSQL,
		MaxRows:   200,
	})
	if err == nil && resp.Error == "" {
		for _, r := range resp.Rows {
			if len(r.Values) > 0 {
				installed[r.Values[0]] = true
			}
		}
	}

	out := make([]gin.H, 0, len(diagnosticCatalogue))
	for _, d := range diagnosticCatalogue {
		out = append(out, gin.H{
			"id":          d.ID,
			"category":    d.Category,
			"description": d.Description,
			"reference":   d.Reference,
			"requiresExt": d.RequiresExt,
			"severity":    d.Severity,
			"available":   d.RequiresExt == "" || installed[d.RequiresExt],
		})
	}
	c.JSON(http.StatusOK, gin.H{"diagnostics": out})
}

// HandleSqlDiagnosticRun executes one catalogue entry by id.
//
// The SQL comes from the catalogue rather than the caller, so this stays safe
// even though the queries themselves are unparameterised.
func HandleSqlDiagnosticRun(c *gin.Context) {
	diag, ok := diagnosticByID(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "unknown diagnostic"})
		return
	}

	resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
		Namespace: c.Param("namespace"),
		DbName:    c.Param("db"),
		Sql:       diag.SQL,
		MaxRows:   1000,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	result := sqlResponseJSON(resp)
	result["id"] = diag.ID
	result["description"] = diag.Description
	result["severity"] = diag.Severity
	result["reference"] = diag.Reference
	c.JSON(http.StatusOK, result)
}

// HandleSqlTableStructure describes one table: columns, indexes, foreign keys
// and constraints, each as a separate result set.
func HandleSqlTableStructure(c *gin.Context) {
	schema := c.DefaultQuery("schema", "public")
	table := c.Param("table")

	// Identifiers are interpolated into these catalogue lookups, so quote them
	// as literals -- a table name is not a bind parameter in this context.
	lit := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	s, t := lit(schema), lit(table)

	queries := map[string]string{
		"columns": `
SELECT a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS nullable,
       COALESCE(pg_get_expr(d.adbin, d.adrelid), '') AS default_value,
       COALESCE(col_description(a.attrelid, a.attnum), '') AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = ` + s + ` AND c.relname = ` + t + `
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`,

		"indexes": `
SELECT i.relname AS index_name,
       am.amname AS method,
       x.indisunique AS is_unique,
       x.indisprimary AS is_primary,
       pg_size_pretty(pg_relation_size(i.oid)) AS size,
       s.idx_scan AS scans,
       pg_get_indexdef(i.oid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class c ON c.oid = x.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_am am ON am.oid = i.relam
LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
WHERE n.nspname = ` + s + ` AND c.relname = ` + t + `
ORDER BY x.indisprimary DESC, i.relname`,

		"foreign_keys": `
SELECT con.conname AS constraint_name,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ` + s + ` AND c.relname = ` + t + ` AND con.contype = 'f'
ORDER BY con.conname`,

		"constraints": `
SELECT con.conname AS constraint_name,
       CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE'
                        WHEN 'c' THEN 'CHECK' WHEN 'x' THEN 'EXCLUDE'
                        ELSE con.contype::text END AS type,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ` + s + ` AND c.relname = ` + t + ` AND con.contype <> 'f'
ORDER BY con.contype, con.conname`,
	}

	out := gin.H{"schema": schema, "table": table}
	for name, q := range queries {
		resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
			Namespace: c.Param("namespace"),
			DbName:    c.Param("db"),
			Sql:       q,
			MaxRows:   500,
		})
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}
		out[name] = sqlResponseJSON(resp)
	}
	c.JSON(http.StatusOK, out)
}

// HandleSqlExplain returns the query plan for a statement.
//
// EXPLAIN ANALYZE actually executes the query, so it is only permitted when the
// caller opts in -- and even then it runs read-only unless writes are allowed.
func HandleSqlExplain(c *gin.Context) {
	var body struct {
		SQL     string `json:"sql"`
		Analyze bool   `json:"analyze"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.SQL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "sql is required"})
		return
	}

	prefix := "EXPLAIN (FORMAT TEXT, VERBOSE, COSTS) "
	if body.Analyze {
		prefix = "EXPLAIN (ANALYZE, FORMAT TEXT, VERBOSE, COSTS, BUFFERS) "
	}

	resp, err := runAgentQuery(c.Param("agent"), &pb.SqlQueryRequest{
		Namespace: c.Param("namespace"),
		DbName:    c.Param("db"),
		Sql:       prefix + body.SQL,
		MaxRows:   1000,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	if resp.Error != "" {
		c.JSON(http.StatusOK, gin.H{"error": resp.Error})
		return
	}

	lines := make([]string, 0, len(resp.Rows))
	for _, r := range resp.Rows {
		if len(r.Values) > 0 {
			lines = append(lines, r.Values[0])
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"plan":       strings.Join(lines, "\n"),
		"durationMs": resp.DurationMs,
	})
}

// RegisterSqlRoutes registers the SQL explorer routes.
func RegisterSqlRoutes(r *gin.Engine) {
	r.POST("/api/agents/:agent/sql/:namespace/:db/query", HandleSqlQuery)
	r.GET("/api/agents/:agent/sql/:namespace/:db/tables", HandleSqlTables)
	r.GET("/api/agents/:agent/sql/:namespace/:db/structure/:table", HandleSqlTableStructure)
	r.POST("/api/agents/:agent/sql/:namespace/:db/explain", HandleSqlExplain)
	r.GET("/api/agents/:agent/sql/:namespace/:db/diagnostics", HandleSqlDiagnosticsList)
	r.POST("/api/agents/:agent/sql/:namespace/:db/diagnostics/:id", HandleSqlDiagnosticRun)
}
