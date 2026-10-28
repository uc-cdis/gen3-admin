package environments

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/uc-cdis/gen3-admin/internal/environments/envtest"
)

const testDiagram = `{
  "version": 1,
  "generator": "tf-arch 1.4.2",
  "stats": {"create": 2},
  "hidden": {"data_sources": 1},
  "bounds": {"width": 800, "height": 600},
  "containers": [{"id": "aws_vpc.main", "type": "network", "title": "VPC: main", "subtitle": "10.0.0.0/16",
                  "x": 10, "y": 10, "width": 500, "height": 400, "after": {"secret": "s3cr3t"}}],
  "nodes": [{"id": "aws_nat_gateway.gw", "address": "aws_nat_gateway.gw", "name": "gw", "type": "aws_nat_gateway",
             "action": "create", "service": "NAT Gateway", "color": "#8C4FFF", "icon": "aws:nat_gateway",
             "x": 40, "y": 60, "width": 180, "height": 80, "tags": {"Owner": "someone"},
             "folded": [{"address": "aws_eip.nat", "type": "aws_eip", "action": "create"}]}],
  "edges": [{"source": "aws_nat_gateway.gw", "target": "aws_vpc.main", "label": "NAT", "kind": "traffic"}],
  "icons": {"aws:nat_gateway": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"}
}`

func TestParseDiagramKeepsOnlyItsShape(t *testing.T) {
	g, err := ParseDiagram([]byte(testDiagram))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Nodes) != 1 || g.Nodes[0].Folded[0].Address != "aws_eip.nat" || g.Nodes[0].Width != 180 {
		t.Errorf("nodes = %+v", g.Nodes)
	}
	b, _ := json.Marshal(g)
	for _, s := range []string{"s3cr3t", "someone", `"after"`, `"tags"`} {
		if strings.Contains(string(b), s) {
			t.Errorf("a field outside the diagram's shape survived: %s", s)
		}
	}
}

func TestParseDiagramRejects(t *testing.T) {
	bad := map[string]func(string) string{
		"script in an icon": func(s string) string { return strings.Replace(s, `</svg>`, `<script>alert(1)</script></svg>`, 1) },
		"icon that is html": func(s string) string { return strings.Replace(s, `"<svg xmlns`, `"<img xmlns`, 1) },
		"bad icon key":      func(s string) string { return strings.Replace(s, `"aws:nat_gateway": "<svg`, `"../x": "<svg`, 1) },
		"unknown action": func(s string) string {
			return strings.Replace(s, `"action": "create", "service"`, `"action": "explode", "service"`, 1)
		},
		"colour that is css": func(s string) string { return strings.Replace(s, `"#8C4FFF"`, `"red;background:url(x)"`, 1) },
		"other version":      func(s string) string { return strings.Replace(s, `"version": 1`, `"version": 2`, 1) },
		"label with a newline": func(s string) string {
			return strings.Replace(s, `"name": "gw",`, `"name": "gw", "label": "a\nb",`, 1)
		},
		"not json": func(string) string { return "{" },
	}
	for name, mutate := range bad {
		if _, err := ParseDiagram([]byte(mutate(testDiagram))); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
	if _, err := ParseDiagram([]byte(strings.Replace(testDiagram, `"generator"`, `"padding": "`+strings.Repeat("x", maxDiagramBytes)+`", "generator"`, 1))); err == nil {
		t.Error("an oversized diagram was accepted")
	}
}

func TestDiagramStoredApartFromRuns(t *testing.T) {
	ctx := context.Background()
	store := NewStore(envtest.NewMemS3(), "bucket")
	id := "11111111-2222-3333-4444-555555555555"
	if err := store.PutRun(ctx, "dev", &Run{ID: id, Operation: "plan", Status: RunSucceeded}); err != nil {
		t.Fatal(err)
	}
	g, _ := ParseDiagram([]byte(testDiagram))
	if err := store.PutDiagram(ctx, "dev", id, g); err != nil {
		t.Fatal(err)
	}
	if runs, _ := store.Runs(ctx, "dev"); len(runs) != 1 {
		t.Errorf("runs = %d; the diagram must not be listed as a run", len(runs))
	}
	got, err := store.GetDiagram(ctx, "dev", id)
	if err != nil || len(got.Nodes) != 1 || got.Icons["aws:nat_gateway"] == "" {
		t.Errorf("GetDiagram = %+v, %v", got, err)
	}
}
