package aws

import (
	"context"
	"sort"
	"strings"
	"testing"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	r53types "github.com/aws/aws-sdk-go-v2/service/route53/types"
)

// fakeRoute53 is one account's zones and their records.
type fakeRoute53 struct {
	zones   map[string]string // name. -> id
	servers map[string][]string
	records map[string][]r53types.ResourceRecordSet // id -> records
	created []string
	changes []r53types.Change
}

func newFake() *fakeRoute53 {
	return &fakeRoute53{zones: map[string]string{}, servers: map[string][]string{}, records: map[string][]r53types.ResourceRecordSet{}}
}

func (f *fakeRoute53) addZone(name, id string, servers ...string) {
	f.zones[name+"."] = id
	f.servers[id] = servers
}

func (f *fakeRoute53) addRecord(zoneID, name string, t r53types.RRType, values ...string) {
	rr := r53types.ResourceRecordSet{Name: awssdk.String(name + "."), Type: t}
	for _, v := range values {
		rr.ResourceRecords = append(rr.ResourceRecords, r53types.ResourceRecord{Value: awssdk.String(v)})
	}
	f.records[zoneID] = append(f.records[zoneID], rr)
}

func (f *fakeRoute53) ListHostedZonesByName(_ context.Context, in *route53.ListHostedZonesByNameInput, _ ...func(*route53.Options)) (*route53.ListHostedZonesByNameOutput, error) {
	out := &route53.ListHostedZonesByNameOutput{}
	if id, ok := f.zones[awssdk.ToString(in.DNSName)]; ok {
		out.HostedZones = append(out.HostedZones, r53types.HostedZone{Id: awssdk.String("/hostedzone/" + id), Name: in.DNSName})
	}
	return out, nil
}

func (f *fakeRoute53) GetHostedZone(_ context.Context, in *route53.GetHostedZoneInput, _ ...func(*route53.Options)) (*route53.GetHostedZoneOutput, error) {
	id := strings.TrimPrefix(awssdk.ToString(in.Id), "/hostedzone/")
	return &route53.GetHostedZoneOutput{DelegationSet: &r53types.DelegationSet{NameServers: f.servers[id]}}, nil
}

func (f *fakeRoute53) CreateHostedZone(_ context.Context, in *route53.CreateHostedZoneInput, _ ...func(*route53.Options)) (*route53.CreateHostedZoneOutput, error) {
	name := awssdk.ToString(in.Name)
	id := "ZNEW" + strings.ToUpper(strings.ReplaceAll(name, ".", ""))
	servers := []string{"ns-1.awsdns-01.org", "ns-2.awsdns-02.com"}
	f.addZone(name, id, servers...)
	f.created = append(f.created, name)
	return &route53.CreateHostedZoneOutput{
		HostedZone:    &r53types.HostedZone{Id: awssdk.String("/hostedzone/" + id), Name: awssdk.String(name + ".")},
		DelegationSet: &r53types.DelegationSet{NameServers: servers},
	}, nil
}

func (f *fakeRoute53) ChangeTagsForResource(context.Context, *route53.ChangeTagsForResourceInput, ...func(*route53.Options)) (*route53.ChangeTagsForResourceOutput, error) {
	return &route53.ChangeTagsForResourceOutput{}, nil
}

// reversed sorts names the way Route53 lists them: by reversed labels.
func reversed(name string) string {
	labels := strings.Split(strings.TrimSuffix(name, "."), ".")
	for i, j := 0, len(labels)-1; i < j; i, j = i+1, j-1 {
		labels[i], labels[j] = labels[j], labels[i]
	}
	return strings.Join(labels, ".")
}

func (f *fakeRoute53) ListResourceRecordSets(_ context.Context, in *route53.ListResourceRecordSetsInput, _ ...func(*route53.Options)) (*route53.ListResourceRecordSetsOutput, error) {
	all := append([]r53types.ResourceRecordSet{}, f.records[awssdk.ToString(in.HostedZoneId)]...)
	sort.Slice(all, func(i, j int) bool {
		return reversed(awssdk.ToString(all[i].Name)) < reversed(awssdk.ToString(all[j].Name))
	})
	start := reversed(awssdk.ToString(in.StartRecordName))
	out := &route53.ListResourceRecordSetsOutput{}
	for _, rr := range all {
		if reversed(awssdk.ToString(rr.Name)) >= start {
			out.ResourceRecordSets = append(out.ResourceRecordSets, rr)
		}
	}
	return out, nil
}

func (f *fakeRoute53) ChangeResourceRecordSets(_ context.Context, in *route53.ChangeResourceRecordSetsInput, _ ...func(*route53.Options)) (*route53.ChangeResourceRecordSetsOutput, error) {
	f.changes = append(f.changes, in.ChangeBatch.Changes...)
	for _, ch := range in.ChangeBatch.Changes {
		f.records[awssdk.ToString(in.HostedZoneId)] = append(f.records[awssdk.ToString(in.HostedZoneId)], *ch.ResourceRecordSet)
	}
	return &route53.ChangeResourceRecordSetsOutput{}, nil
}

func noPublicDNS(t *testing.T) {
	t.Helper()
	prev := lookupNS
	lookupNS = func(context.Context, string) ([]string, error) { return nil, context.DeadlineExceeded }
	t.Cleanup(func() { lookupNS = prev })
}

func TestSetupZoneCreatesAndDelegates(t *testing.T) {
	noPublicDNS(t)
	child, parent := newFake(), newFake()
	parent.addZone("example.org", "ZPARENT")
	parent.addRecord("ZPARENT", "csoc.example.org", r53types.RRTypeA, "192.0.2.1") // a sibling, not under the new zone
	parent.addRecord("ZPARENT", "www.example.org", r53types.RRTypeA, "192.0.2.2")

	res, err := setupZone(context.Background(), child, parent, "workshop.example.org")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || len(child.created) != 1 {
		t.Errorf("zone not created: %+v", res)
	}
	if res.Delegation != DelegationAdded || res.ParentZoneName != "example.org" {
		t.Errorf("delegation = %s from %q", res.Delegation, res.ParentZoneName)
	}
	if len(parent.changes) != 1 || parent.changes[0].Action != r53types.ChangeActionCreate ||
		parent.changes[0].ResourceRecordSet.Type != r53types.RRTypeNs {
		t.Fatalf("parent changes = %+v", parent.changes)
	}

	// Running it again finds both and changes nothing.
	res, err = setupZone(context.Background(), child, parent, "workshop.example.org")
	if err != nil {
		t.Fatal(err)
	}
	if res.Created || res.Delegation != DelegationOK || len(parent.changes) != 1 || len(child.created) != 1 {
		t.Errorf("re-run: created=%v delegation=%s changes=%d", res.Created, res.Delegation, len(parent.changes))
	}
}

func TestSetupZoneRefusesToHideRecords(t *testing.T) {
	noPublicDNS(t)
	for name, add := range map[string]func(*fakeRoute53){
		"record at the name": func(p *fakeRoute53) { p.addRecord("ZPARENT", "workshop.example.org", r53types.RRTypeA, "192.0.2.1") },
		"record under the name": func(p *fakeRoute53) {
			p.addRecord("ZPARENT", "app.workshop.example.org", r53types.RRTypeCname, "x.example.net")
		},
		"another zone's servers": func(p *fakeRoute53) {
			p.addRecord("ZPARENT", "workshop.example.org", r53types.RRTypeNs, "ns-9.other.net.")
		},
	} {
		child, parent := newFake(), newFake()
		parent.addZone("example.org", "ZPARENT")
		add(parent)
		res, err := setupZone(context.Background(), child, parent, "workshop.example.org")
		if err != nil {
			t.Fatal(err)
		}
		if res.Delegation != DelegationConflict || len(res.Conflicts) == 0 {
			t.Errorf("%s: delegation = %s, conflicts %v", name, res.Delegation, res.Conflicts)
		}
		if len(parent.changes) != 0 {
			t.Errorf("%s: parent was changed", name)
		}
	}
}

func TestSetupZoneWithoutParentAccess(t *testing.T) {
	noPublicDNS(t)
	child := newFake()
	child.addZone("workshop.example.org", "ZCHILD", "ns-1.awsdns-01.org.", "NS-2.awsdns-02.com")
	res, err := setupZone(context.Background(), child, nil, "workshop.example.org")
	if err != nil {
		t.Fatal(err)
	}
	if res.Created || res.Delegation != DelegationManual || res.ZoneID != "ZCHILD" {
		t.Errorf("result = %+v", res)
	}
	if strings.Join(res.NameServers, ",") != "ns-1.awsdns-01.org,ns-2.awsdns-02.com" {
		t.Errorf("name servers = %v, want them normalised", res.NameServers)
	}

	// A parent account without the parent zone is also manual.
	res, err = setupZone(context.Background(), child, newFake(), "workshop.example.org")
	if err != nil || res.Delegation != DelegationManual {
		t.Errorf("parent without the zone: %v %v", res, err)
	}
}

func TestSetupZoneReportsPublicResolution(t *testing.T) {
	prev := lookupNS
	lookupNS = func(_ context.Context, name string) ([]string, error) {
		return []string{"NS-2.awsdns-02.com.", "ns-1.awsdns-01.org."}, nil
	}
	t.Cleanup(func() { lookupNS = prev })
	child := newFake()
	child.addZone("workshop.example.org", "ZCHILD", "ns-1.awsdns-01.org", "ns-2.awsdns-02.com")
	res, err := setupZone(context.Background(), child, nil, "workshop.example.org")
	if err != nil || !res.Resolves {
		t.Errorf("resolves = %v, err %v", res.Resolves, err)
	}
}
