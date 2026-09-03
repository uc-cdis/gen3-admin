package server

// Curated Postgres diagnostic queries.
//
// The catalogue-as-data approach and many of the queries below are adapted from
// pgAssistant (https://github.com/nexsol-technologies/pgassistant), MIT licensed,
// Copyright (c) 2024 neXsol technologies. Individual queries carry their own
// upstream references where applicable.
//
// Two conventions are worth knowing:
//
//   - A `pga_suggestion` column, where present, holds executable remediation DDL.
//     It is displayed for the operator to copy; nothing here runs it automatically.
//   - `RequiresExt` gates a query on an extension. Rather than letting the query
//     fail and showing an error (which is what upstream does), the UI hides the
//     section when the extension is absent. This matters on AWS Aurora, where
//     pg_stat_statements is commonly not enabled.

// Diagnostic is one catalogue entry.
type Diagnostic struct {
	ID          string `json:"id"`
	Category    string `json:"category"`
	Description string `json:"description"`
	SQL         string `json:"-"`
	Reference   string `json:"reference,omitempty"`
	// RequiresExt names an extension this query depends on, empty when it runs
	// on a stock database.
	RequiresExt string `json:"requiresExt,omitempty"`
	// Severity hints at how the UI should present findings: "issue" means any
	// row returned is a problem; "info" is purely descriptive.
	Severity string `json:"severity"`
}

var diagnosticCatalogue = []Diagnostic{
	// ── Schema issues ──────────────────────────────────────────────────────
	{
		ID:          "issue_idx_fk_missing",
		Category:    "Schema issues",
		Description: "Foreign keys with no supporting index (causes slow joins and lock contention on delete)",
		Severity:    "issue",
		Reference:   "https://www.stratoflow.com/postgresql-performance-tuning/",
		SQL: `
WITH fkeys_without_indexes AS (
  SELECT conname AS fk_name, conrelid::regclass AS table_name, a.attname AS column_name,
         n.nspname AS schema_name
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN unnest(c.conkey) AS col_num ON true
  JOIN pg_attribute a ON a.attnum = col_num AND a.attrelid = r.oid
  LEFT JOIN pg_index i ON i.indrelid = r.oid AND col_num = ANY (i.indkey)
  WHERE c.contype = 'f' AND i.indexrelid IS NULL
)
SELECT schema_name, table_name::text, column_name,
       'CREATE INDEX idx_fk_' || table_name || '_' || column_name ||
       ' ON ' || schema_name || '.' || table_name || '(' || column_name || ');' AS pga_suggestion
FROM fkeys_without_indexes
ORDER BY schema_name, table_name, column_name`,
	},
	{
		ID:          "issue_idx_fk_datatype",
		Category:    "Schema issues",
		Description: "Foreign key columns whose type differs from the referenced column (prevents index use)",
		Severity:    "issue",
		SQL: `
WITH foreign_key_columns AS (
  SELECT conname AS fk_name, conrelid::regclass AS fk_table, confrelid::regclass AS ref_table,
         att2.attname AS fk_column, att1.attname AS ref_column, n.nspname AS schema_name,
         pg_catalog.format_type(att2.atttypid, att2.atttypmod) AS fk_column_type,
         pg_catalog.format_type(att1.atttypid, att1.atttypmod) AS ref_column_type
  FROM pg_constraint c
  INNER JOIN pg_namespace n ON n.oid = c.connamespace
  INNER JOIN pg_attribute att1 ON att1.attnum = ANY (c.confkey) AND att1.attrelid = c.confrelid
  INNER JOIN pg_attribute att2 ON att2.attnum = ANY (c.conkey)  AND att2.attrelid = c.conrelid
  WHERE c.contype = 'f'
)
SELECT fk_name, schema_name, fk_table::text, fk_column, ref_table::text, ref_column,
       fk_column_type, ref_column_type,
       'ALTER TABLE ' || schema_name || '.' || fk_table ||
       ' ALTER COLUMN ' || fk_column || ' TYPE ' || ref_column_type ||
       ' USING ' || fk_column || '::' || ref_column_type || ';' AS pga_suggestion
FROM foreign_key_columns
WHERE fk_column_type <> ref_column_type
ORDER BY schema_name, fk_table, fk_name`,
	},
	{
		ID:          "issue_idx_duplicate",
		Category:    "Schema issues",
		Description: "Indexes covering exactly the same columns (wasted storage and write cost)",
		Severity:    "issue",
		SQL: `
SELECT indrelid::regclass::text AS table_name,
       array_agg(indexrelid::regclass)::text AS duplicate_indexes
FROM pg_index
GROUP BY indrelid, indkey
HAVING COUNT(*) > 1`,
	},
	{
		ID:          "issue_no_pk",
		Category:    "Schema issues",
		Description: "Tables without a primary key (breaks logical replication and row identification)",
		Severity:    "issue",
		SQL: `
SELECT n.nspname AS schema_name, c.relname AS table_name
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    WHERE con.conrelid = c.oid AND con.contype = 'p'
  )
ORDER BY 1, 2`,
	},
	{
		ID:          "issue_column_diff_type",
		Category:    "Schema issues",
		Description: "Columns sharing a name across tables but declared with different types",
		Severity:    "issue",
		SQL: `
SELECT column_name,
       array_agg(DISTINCT data_type)::text AS types,
       array_agg(DISTINCT table_name)::text AS tables
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
GROUP BY column_name
HAVING COUNT(DISTINCT data_type) > 1
ORDER BY column_name`,
	},

	// ── Indexes ────────────────────────────────────────────────────────────
	{
		ID:          "index_unused",
		Category:    "Indexes",
		Description: "Indexes never used by a scan. Note idx_scan is cumulative since the last stats reset, and Aurora resets it on failover",
		Severity:    "issue",
		SQL: `
SELECT a.schemaname, a.relname AS table_name, a.indexrelname AS index_name,
       pg_size_pretty(pg_relation_size(a.indexrelid)) AS index_size,
       b.indexdef,
       'DROP INDEX ' || a.schemaname || '.' || a.indexrelname || ';' AS pga_suggestion
FROM pg_stat_user_indexes a
JOIN pg_indexes b
  ON a.schemaname = b.schemaname AND a.relname = b.tablename AND a.indexrelname = b.indexname
WHERE a.idx_scan = 0
  -- Constraint-backing indexes cannot simply be dropped.
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conindid = a.indexrelid
  )
ORDER BY pg_relation_size(a.indexrelid) DESC`,
	},
	{
		ID:          "index_usage",
		Category:    "Indexes",
		Description: "Percentage of scans served by an index per table (low values on large tables suggest a missing index)",
		Severity:    "info",
		SQL: `
SELECT relname AS table_name,
       CASE WHEN seq_scan + idx_scan = 0 THEN NULL
            ELSE round(100.0 * idx_scan / (seq_scan + idx_scan), 1)
       END AS pct_index_used,
       seq_scan, idx_scan, n_live_tup AS live_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC`,
	},
	{
		ID:          "index_definitions",
		Category:    "Indexes",
		Description: "All index definitions with size and access method",
		Severity:    "info",
		SQL: `
SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
       am.amname AS method,
       pg_size_pretty(pg_relation_size(i.oid)) AS size,
       pg_get_indexdef(i.oid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY n.nspname, t.relname, i.relname`,
	},

	// ── pgvector ───────────────────────────────────────────────────────────
	// Not present in pgAssistant; written for Gen3's embedding databases.
	{
		ID:          "issue_vector_no_ann_index",
		Category:    "pgvector",
		Description: "Vector columns with no HNSW or IVFFlat index -- similarity search will sequentially scan",
		Severity:    "issue",
		Reference:   "https://github.com/pgvector/pgvector#indexing",
		SQL: `
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS column_type,
       'CREATE INDEX ON ' || n.nspname || '.' || c.relname ||
       ' USING hnsw (' || a.attname || ' vector_cosine_ops);' AS pga_suggestion
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_type ty ON ty.oid = a.atttypid
WHERE c.relkind = 'r'
  AND a.attnum > 0
  AND NOT a.attisdropped
  AND ty.typname IN ('vector','halfvec','sparsevec','bit')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_index x
    JOIN pg_class ic ON ic.oid = x.indexrelid
    JOIN pg_am am ON am.oid = ic.relam
    WHERE x.indrelid = c.oid
      AND a.attnum = ANY (x.indkey)
      AND am.amname IN ('hnsw','ivfflat')
  )
ORDER BY 1, 2, 3`,
	},
	{
		ID:          "vector_index_config",
		Category:    "pgvector",
		Description: "Existing vector indexes and their build parameters (m, ef_construction, lists)",
		Severity:    "info",
		SQL: `
SELECT n.nspname AS schema_name, t.relname AS table_name, i.relname AS index_name,
       am.amname AS method,
       pg_size_pretty(pg_relation_size(i.oid)) AS size,
       pg_get_indexdef(i.oid) AS definition
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_am am ON am.oid = i.relam
WHERE am.amname IN ('hnsw','ivfflat')
ORDER BY n.nspname, t.relname`,
	},

	// ── Tables & storage ───────────────────────────────────────────────────
	{
		ID:          "table_sizes",
		Category:    "Tables",
		Description: "Table sizes including indexes and TOAST",
		Severity:    "info",
		SQL: `
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
       pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes_size,
       s.n_live_tup AS live_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE c.relkind IN ('r','p','m')
  AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC`,
	},
	{
		ID:          "vacuum_suggestions",
		Category:    "Tables",
		Description: "Dead tuple accumulation and vacuum/analyze recency",
		Severity:    "info",
		SQL: `
SELECT schemaname || '.' || relname AS table_name,
       n_live_tup AS live_rows, n_dead_tup AS dead_rows, n_tup_upd AS updates,
       pg_size_pretty(pg_total_relation_size(relid)) AS size,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       CASE
         WHEN n_dead_tup > 1000 THEN 'VACUUM ANALYZE ' || schemaname || '.' || relname || ';'
         WHEN last_analyze IS NULL AND last_autoanalyze IS NULL
           THEN 'ANALYZE ' || schemaname || '.' || relname || ';'
         ELSE NULL
       END AS pga_suggestion
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC, pg_total_relation_size(relid) DESC`,
	},
	{
		ID:          "bloat_estimate",
		Category:    "Tables",
		Description: "Estimated table bloat from dead tuple ratio (an approximation; pgstattuple gives exact figures)",
		Severity:    "info",
		SQL: `
SELECT schemaname || '.' || relname AS table_name,
       n_live_tup AS live_rows, n_dead_tup AS dead_rows,
       CASE WHEN n_live_tup + n_dead_tup = 0 THEN 0
            ELSE round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 1)
       END AS dead_pct,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC`,
	},

	// ── Activity & health ──────────────────────────────────────────────────
	{
		ID:          "cache_hit_ratio",
		Category:    "Health",
		Description: "Heap cache hit ratio -- sustained values below ~99% suggest memory pressure",
		Severity:    "info",
		SQL: `
SELECT round(100.0 * sum(heap_blks_hit) /
             NULLIF(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) AS cache_hit_pct,
       sum(heap_blks_hit) AS blocks_from_cache,
       sum(heap_blks_read) AS blocks_from_disk
FROM pg_statio_user_tables`,
	},
	{
		ID:          "running_queries",
		Category:    "Health",
		Description: "Currently executing queries, longest first",
		Severity:    "info",
		SQL: `
SELECT pid, usename AS username, state,
       now() - query_start AS duration,
       wait_event_type, wait_event,
       left(query, 400) AS query
FROM pg_stat_activity
WHERE state <> 'idle' AND pid <> pg_backend_pid()
ORDER BY query_start`,
	},
	{
		ID:          "blocking_locks",
		Category:    "Health",
		Description: "Sessions blocked waiting on a lock, with the blocking PID",
		Severity:    "issue",
		SQL: `
SELECT a.pid AS blocked_pid, a.usename AS blocked_user,
       left(a.query, 200) AS blocked_query,
       pg_blocking_pids(a.pid)::text AS blocking_pids,
       now() - a.query_start AS blocked_for
FROM pg_stat_activity a
WHERE cardinality(pg_blocking_pids(a.pid)) > 0
ORDER BY a.query_start`,
	},
	{
		ID:          "connection_count",
		Category:    "Health",
		Description: "Connections by state against max_connections",
		Severity:    "info",
		SQL: `
SELECT state,
       count(*) AS connections,
       current_setting('max_connections') AS max_connections
FROM pg_stat_activity
GROUP BY state
ORDER BY count(*) DESC`,
	},
	{
		ID:          "sequence_exhaustion",
		Category:    "Health",
		Description: "Sequences approaching their maximum value (integer overflow risk)",
		Severity:    "issue",
		SQL: `
SELECT schemaname || '.' || sequencename AS sequence_name,
       last_value, max_value,
       CASE WHEN max_value = 0 THEN 0
            ELSE round(100.0 * COALESCE(last_value, 0) / max_value, 4)
       END AS pct_used
FROM pg_sequences
WHERE last_value IS NOT NULL
ORDER BY pct_used DESC`,
	},
	{
		ID:          "database_info",
		Category:    "Health",
		Description: "Server version, database size, and when statistics were last reset",
		Severity:    "info",
		SQL: `
SELECT version() AS server_version,
       current_database() AS database,
       pg_size_pretty(pg_database_size(current_database())) AS size,
       (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset`,
	},
	{
		ID:          "installed_extensions",
		Category:    "Health",
		Description: "Installed extensions and their versions",
		Severity:    "info",
		SQL: `
SELECT extname AS extension, extversion AS version
FROM pg_extension ORDER BY extname`,
	},

	// ── Query performance (requires pg_stat_statements) ────────────────────
	{
		ID:          "top_queries_by_time",
		Category:    "Query performance",
		Description: "Slowest queries by cumulative execution time",
		Severity:    "info",
		RequiresExt: "pg_stat_statements",
		SQL: `
SELECT calls, rows,
       round(total_exec_time::numeric, 2) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       round((100.0 * shared_blks_hit /
              NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 1) AS cache_hit_pct,
       left(query, 500) AS query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_catalog%'
ORDER BY total_exec_time DESC
LIMIT 50`,
	},
	{
		ID:          "top_queries_by_calls",
		Category:    "Query performance",
		Description: "Most frequently executed queries",
		Severity:    "info",
		RequiresExt: "pg_stat_statements",
		SQL: `
SELECT calls, rows,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       round(total_exec_time::numeric, 2) AS total_ms,
       left(query, 500) AS query
FROM pg_stat_statements
WHERE query NOT LIKE '%pg_catalog%'
ORDER BY calls DESC
LIMIT 50`,
	},
}

// diagnosticByID looks up a catalogue entry.
func diagnosticByID(id string) (Diagnostic, bool) {
	for _, d := range diagnosticCatalogue {
		if d.ID == id {
			return d, true
		}
	}
	return Diagnostic{}, false
}

// extensionCheckSQL reports which gated extensions are installed, so the UI can
// hide sections that would otherwise fail.
const extensionCheckSQL = `SELECT extname FROM pg_extension`
