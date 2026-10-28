package aws

import (
	"context"
	"errors"
	"testing"

	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

func TestTeardownZoneRemovesZoneAndDelegation(t *testing.T) {
	noPublicDNS(t)
	child, parent := newFake(), newFake()
	parent.addZone("example.org", "ZPARENT")
	if _, err := setupZone(context.Background(), child, parent, "workshop.example.org"); err != nil {
		t.Fatal(err)
	}
	id := child.zones["workshop.example.org."]
	child.addRecord(id, "workshop.example.org", r53types.RRTypeSoa, "ns-1 hostmaster 1")
	child.addRecord(id, "workshop.example.org", r53types.RRTypeNs, "ns-1.awsdns-01.org.")
	child.addRecord(id, "_abc.commons.workshop.example.org", r53types.RRTypeCname, "_x.acm-validations.aws.")

	// A validation record left behind stops the delete until asked.
	res, err := teardownZone(context.Background(), child, parent, "workshop.example.org", false)
	if err != nil || res.Deleted || len(res.Remaining) != 1 || res.Remaining[0] != "_abc.commons.workshop.example.org CNAME" {
		t.Fatalf("teardown without records = %+v, %v", res, err)
	}
	res, err = teardownZone(context.Background(), child, parent, "workshop.example.org", true)
	if err != nil || !res.Deleted || res.Delegation != "removed" || res.ParentZone != "example.org" {
		t.Fatalf("teardown = %+v, %v", res, err)
	}
	if len(child.deleted) != 1 || len(parent.records["ZPARENT"]) != 0 {
		t.Errorf("zone deleted %v, parent records left %v", child.deleted, parent.records["ZPARENT"])
	}
}

func TestTeardownZoneLeavesZonesItDidNotCreate(t *testing.T) {
	child := newFake()
	child.addZone("prod.example.org", "ZPROD", "ns-9.awsdns-09.net")
	_, err := teardownZone(context.Background(), child, nil, "prod.example.org", true)
	if !errors.Is(err, errNotOurZone) || len(child.deleted) != 0 {
		t.Errorf("untagged zone: err %v, deleted %v", err, child.deleted)
	}
}

func TestTeardownZoneLeavesSomeoneElsesDelegation(t *testing.T) {
	noPublicDNS(t)
	child, parent := newFake(), newFake()
	parent.addZone("example.org", "ZPARENT")
	parent.addRecord("ZPARENT", "workshop.example.org", r53types.RRTypeNs, "ns-7.other.net.")
	res, err := teardownZone(context.Background(), child, parent, "workshop.example.org", false)
	if err != nil || res.Deleted || res.Delegation != "none" || len(parent.records["ZPARENT"]) != 1 {
		t.Errorf("teardown of a missing zone = %+v, %v; parent %v", res, err, parent.records["ZPARENT"])
	}
}

func TestTeardownZoneWithoutAReachableParentIsManual(t *testing.T) {
	noPublicDNS(t)
	child := newFake()
	if _, err := setupZone(context.Background(), child, nil, "workshop.example.org"); err != nil {
		t.Fatal(err)
	}
	// The parent lives in another account: these credentials see no zone.
	res, err := teardownZone(context.Background(), child, newFake(), "workshop.example.org", false)
	if err != nil || !res.Deleted || res.Delegation != "manual" {
		t.Errorf("teardown = %+v, %v", res, err)
	}
}
