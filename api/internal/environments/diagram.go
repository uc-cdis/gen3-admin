package environments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// PlanDiagram is the architecture diagram of a plan, as drawn by
// scripts/runner/plan-diagram.mjs: positioned resources inside their VPC,
// zone and subnet boxes, and the edges between them. It is decoded into this
// fixed shape, so nothing but these fields is ever stored, whatever the
// script wrote.
type PlanDiagram struct {
	Version    int                `json:"version"`
	Generator  string             `json:"generator"`
	Stats      map[string]int     `json:"stats"`
	Hidden     map[string]int     `json:"hidden"`
	Bounds     DiagramBox         `json:"bounds"`
	Containers []DiagramContainer `json:"containers"`
	Nodes      []DiagramNode      `json:"nodes"`
	Edges      []DiagramEdge      `json:"edges"`
	// Icons maps an icon key to its SVG: the official vendor icon for each
	// service in the diagram.
	Icons map[string]string `json:"icons"`
}

type DiagramBox struct {
	X      float64 `json:"x,omitempty"`
	Y      float64 `json:"y,omitempty"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type DiagramContainer struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Title    string `json:"title"`
	Label    string `json:"label"`
	Subtitle string `json:"subtitle"`
	Tier     string `json:"tier"`
	Action   string `json:"action"`
	DiagramBox
	Folded []DiagramFolded `json:"folded"`
}

type DiagramNode struct {
	ID      string `json:"id"`
	Address string `json:"address"`
	Name    string `json:"name"`
	// Label is the resource's Name tag or name attribute, when the plan
	// knows it and does not mark it sensitive.
	Label    string `json:"label"`
	Type     string `json:"type"`
	Action   string `json:"action"`
	Service  string `json:"service"`
	Category string `json:"category"`
	Color    string `json:"color"`
	Icon     string `json:"icon"`
	// Container is the innermost box the node sits in, if any.
	Container string `json:"container"`
	DiagramBox
	// Folded are the resources that only configure this one (policy
	// attachments, route table associations, bucket settings).
	Folded []DiagramFolded `json:"folded"`
}

type DiagramFolded struct {
	Address string `json:"address"`
	Type    string `json:"type"`
	Action  string `json:"action"`
}

type DiagramEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Label  string `json:"label"`
	Kind   string `json:"kind"`
}

const (
	maxDiagramBytes = 8 << 20
	maxDiagramItems = 5000
	maxIconBytes    = 64 << 10
)

var (
	validIconKey  = regexp.MustCompile(`^[a-z]+:[a-z0-9_]{1,64}$`)
	validColor    = regexp.MustCompile(`^(#[0-9A-Fa-f]{3,8})?$`)
	validLabel    = regexp.MustCompile(`^[\x20-\x7E]{0,128}$`)
	diagramAction = map[string]bool{"create": true, "update": true, "delete": true, "replace": true, "noop": true, "read": true, "": true}
)

// ParseDiagram decodes and checks a diagram. Text is shown as text by the
// portal, and icons are shown as images, never inlined, so the checks here
// are about shape and size rather than escaping.
func ParseDiagram(raw []byte) (*PlanDiagram, error) {
	if len(raw) > maxDiagramBytes {
		return nil, fmt.Errorf("diagram is %d bytes, over the %d limit", len(raw), maxDiagramBytes)
	}
	var g PlanDiagram
	if err := json.Unmarshal(raw, &g); err != nil {
		return nil, fmt.Errorf("diagram JSON: %w", err)
	}
	if g.Version != 1 {
		return nil, fmt.Errorf("diagram version %d is not supported", g.Version)
	}
	if len(g.Nodes)+len(g.Containers) > maxDiagramItems || len(g.Edges) > maxDiagramItems {
		return nil, errors.New("diagram has too many items")
	}
	for _, n := range g.Nodes {
		if n.ID == "" || !diagramAction[n.Action] || !validColor.MatchString(n.Color) || !validLabel.MatchString(n.Label) ||
			(n.Icon != "" && !validIconKey.MatchString(n.Icon)) {
			return nil, fmt.Errorf("diagram node %q is not valid", n.ID)
		}
	}
	for _, c := range g.Containers {
		if c.ID == "" || !diagramAction[c.Action] || !validLabel.MatchString(c.Label) {
			return nil, fmt.Errorf("diagram container %q is not valid", c.ID)
		}
	}
	for key, svg := range g.Icons {
		trimmed := bytes.TrimSpace([]byte(svg))
		if !validIconKey.MatchString(key) || len(svg) > maxIconBytes || !bytes.HasPrefix(trimmed, []byte("<svg")) ||
			strings.Contains(strings.ToLower(svg), "<script") {
			return nil, fmt.Errorf("diagram icon %q is not a plain SVG", key)
		}
	}
	return &g, nil
}

func (s *Store) diagramKey(name, id string) string {
	return Prefix + name + "/plans/" + id + ".diagram.json"
}

func (s *Store) PutDiagram(ctx context.Context, env, id string, g *PlanDiagram) error {
	return s.putJSON(ctx, s.diagramKey(env, id), g)
}

func (s *Store) GetDiagram(ctx context.Context, env, id string) (*PlanDiagram, error) {
	if !ValidName(env) || !validRunID.MatchString(id) {
		return nil, fmt.Errorf("invalid environment or run id")
	}
	b, err := s.get(ctx, s.diagramKey(env, id))
	if err != nil {
		return nil, err
	}
	var g PlanDiagram
	if err := json.Unmarshal(b, &g); err != nil {
		return nil, err
	}
	return &g, nil
}
