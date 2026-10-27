package aws

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/credentials/stscreds"
	"github.com/aws/aws-sdk-go-v2/service/ec2"
	ec2types "github.com/aws/aws-sdk-go-v2/service/ec2/types"
	"github.com/aws/aws-sdk-go-v2/service/route53"
	"github.com/aws/aws-sdk-go-v2/service/sts"
	"github.com/gin-gonic/gin"
)

// Target says which AWS identity a lookup runs as. It travels with each
// request so the wizard checks the same credentials Terraform will use,
// instead of whatever the server process happens to have.
type Target struct {
	Profile     string       `json:"profile,omitempty"`
	Region      string       `json:"region,omitempty"`
	Credentials *Credentials `json:"credentials,omitempty"`
	// RoleARN, when set, is assumed on top of the profile or credentials, for
	// deploying into an account the operator does not log in to directly.
	RoleARN string `json:"role_arn,omitempty"`
}

type Credentials struct {
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
	SessionToken    string `json:"session_token,omitempty"`
}

var (
	validProfileName = regexp.MustCompile(`^[A-Za-z0-9_.@+-]{1,128}$`)
	validRegionName  = regexp.MustCompile(`^[a-z]{2}(-[a-z]+)+-[0-9]$`)
	validDomain      = regexp.MustCompile(`^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	validRoleARN     = regexp.MustCompile(`^arn:aws[a-z-]*:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]{1,512}$`)
)

// roleSessionName shows up in CloudTrail for everything a run does.
const roleSessionName = "gen3-csoc"

// LoadConfig is loadConfig for other packages that act on a request's
// behalf, such as the environment registry.
func LoadConfig(ctx context.Context, t Target) (awssdk.Config, error) { return loadConfig(ctx, t) }

// loadConfig builds an SDK config for exactly this target: explicit keys, or
// a named profile, or the default chain. It never touches process-wide state,
// so concurrent lookups for different accounts cannot see each other's
// credentials.
func loadConfig(ctx context.Context, t Target) (awssdk.Config, error) {
	var opts []func(*config.LoadOptions) error

	region := t.Region
	if region == "" {
		region = "us-east-1"
	}
	if !validRegionName.MatchString(region) {
		return awssdk.Config{}, fmt.Errorf("invalid region")
	}
	opts = append(opts, config.WithRegion(region))

	switch {
	case t.Credentials != nil && t.Credentials.AccessKeyID != "":
		c := t.Credentials
		if c.SecretAccessKey == "" {
			return awssdk.Config{}, fmt.Errorf("secret access key is required")
		}
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, c.SessionToken)))
	case t.Profile != "":
		if !validProfileName.MatchString(t.Profile) {
			return awssdk.Config{}, fmt.Errorf("invalid profile name")
		}
		opts = append(opts, config.WithSharedConfigProfile(t.Profile))
	}

	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil || t.RoleARN == "" {
		return cfg, err
	}
	if !validRoleARN.MatchString(t.RoleARN) {
		return awssdk.Config{}, fmt.Errorf("invalid role ARN")
	}
	cfg.Credentials = awssdk.NewCredentialsCache(
		stscreds.NewAssumeRoleProvider(sts.NewFromConfig(cfg), t.RoleARN, func(o *stscreds.AssumeRoleOptions) {
			o.RoleSessionName = roleSessionName
		}))
	return cfg, nil
}

// AssumeRoleCredentials returns temporary credentials for t.RoleARN, for
// handing to a Terraform run. It asks for a long session first, since an EKS
// apply can outlast the one-hour default, and falls back to an hour when the
// role's maximum (or role chaining from SSO) does not allow more.
func AssumeRoleCredentials(ctx context.Context, t Target) (*Credentials, error) {
	role := t.RoleARN
	t.RoleARN = ""
	if !validRoleARN.MatchString(role) {
		return nil, fmt.Errorf("invalid role ARN")
	}
	cfg, err := loadConfig(ctx, t)
	if err != nil {
		return nil, err
	}
	client := sts.NewFromConfig(cfg)

	var out *sts.AssumeRoleOutput
	for _, seconds := range []int32{4 * 3600, 3600} {
		out, err = client.AssumeRole(ctx, &sts.AssumeRoleInput{
			RoleArn:         awssdk.String(role),
			RoleSessionName: awssdk.String(roleSessionName),
			DurationSeconds: awssdk.Int32(seconds),
		})
		if err == nil || !strings.Contains(err.Error(), "DurationSeconds") {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("assume %s: %s", role, awsErrorMessage(err))
	}
	return &Credentials{
		AccessKeyID:     awssdk.ToString(out.Credentials.AccessKeyId),
		SecretAccessKey: awssdk.ToString(out.Credentials.SecretAccessKey),
		SessionToken:    awssdk.ToString(out.Credentials.SessionToken),
	}, nil
}

func bindTarget[T any](c *gin.Context, into *T) bool {
	if err := c.ShouldBindJSON(into); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return false
	}
	return true
}

func lookupContext(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), 20*time.Second)
}

// IdentityHandler reports who the given target authenticates as.
// POST /api/aws/identity  {profile | credentials, region}
func IdentityHandler(c *gin.Context) {
	var t Target
	if !bindTarget(c, &t) {
		return
	}
	ctx, cancel := lookupContext(c)
	defer cancel()

	cfg, err := loadConfig(ctx, t)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if err != nil {
		c.JSON(http.StatusUnauthorized, identityError(t.Profile, err))
		return
	}
	res := gin.H{
		"Account": awssdk.ToString(out.Account),
		"Arn":     awssdk.ToString(out.Arn),
		"UserId":  awssdk.ToString(out.UserId),
	}
	// When the SSO sign-in behind these credentials ends: a long run must
	// finish before it does.
	if t.Credentials == nil {
		if exp, ok := ssoSessionExpiry(t.Profile); ok {
			res["session_expires_at"] = exp.UTC().Format(time.RFC3339)
		}
	}
	c.JSON(http.StatusOK, res)
}

// HostedZoneHandler finds the public Route53 hosted zone that would serve a
// domain, walking up its labels: csoc.example.org is served by a zone for
// csoc.example.org or, failing that, example.org.
// POST /api/aws/route53/zone  {domain, profile | credentials}
func HostedZoneHandler(c *gin.Context) {
	var req struct {
		Target
		Domain string `json:"domain"`
	}
	if !bindTarget(c, &req) {
		return
	}
	domain := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(req.Domain)), ".")
	if !validDomain.MatchString(domain) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not a valid domain name"})
		return
	}

	ctx, cancel := lookupContext(c)
	defer cancel()
	cfg, err := loadConfig(ctx, req.Target)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	client := route53.NewFromConfig(cfg)

	labels := strings.Split(domain, ".")
	for i := 0; i < len(labels)-1; i++ {
		candidate := strings.Join(labels[i:], ".") + "."
		out, err := client.ListHostedZonesByName(ctx, &route53.ListHostedZonesByNameInput{
			DNSName:  awssdk.String(candidate),
			MaxItems: awssdk.Int32(10),
		})
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
			return
		}
		for _, z := range out.HostedZones {
			// ListHostedZonesByName starts at the name and continues
			// alphabetically, so only an exact match counts. Private zones
			// cannot serve the public records the ALB and ACM need.
			if awssdk.ToString(z.Name) != candidate || (z.Config != nil && z.Config.PrivateZone) {
				continue
			}
			// A zone nobody delegated to answers no one: ACM would wait
			// for validation records that resolvers never see.
			resolves := false
			if hz, err := client.GetHostedZone(ctx, &route53.GetHostedZoneInput{Id: z.Id}); err == nil && hz.DelegationSet != nil {
				resolves = publiclyDelegated(ctx, strings.TrimSuffix(candidate, "."), hz.DelegationSet.NameServers)
			}
			c.JSON(http.StatusOK, gin.H{
				"found":          true,
				"hosted_zone_id": strings.TrimPrefix(awssdk.ToString(z.Id), "/hostedzone/"),
				"zone_name":      strings.TrimSuffix(candidate, "."),
				"domain":         domain,
				"resolves":       resolves,
			})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"found": false, "domain": domain})
}

// AvailabilityZonesHandler lists a region's available zones. Zone letters are
// assigned per account and some regions have fewer than three, so guessing
// "<region>a/b/c" fails in places like us-west-1.
// POST /api/aws/azs  {region, profile | credentials}
func AvailabilityZonesHandler(c *gin.Context) {
	var t Target
	if !bindTarget(c, &t) {
		return
	}
	ctx, cancel := lookupContext(c)
	defer cancel()
	cfg, err := loadConfig(ctx, t)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	out, err := ec2.NewFromConfig(cfg).DescribeAvailabilityZones(ctx, &ec2.DescribeAvailabilityZonesInput{
		Filters: []ec2types.Filter{
			{Name: awssdk.String("state"), Values: []string{"available"}},
			{Name: awssdk.String("zone-type"), Values: []string{"availability-zone"}},
		},
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": awsErrorMessage(err)})
		return
	}
	zones := make([]string, 0, len(out.AvailabilityZones))
	for _, z := range out.AvailabilityZones {
		zones = append(zones, awssdk.ToString(z.ZoneName))
	}
	sort.Strings(zones)
	c.JSON(http.StatusOK, gin.H{"region": cfg.Region, "zones": zones})
}

// identityError explains a failed identity check. An expired SSO session is
// by far the most common cause and the fix is a command the operator runs
// themselves, so it gets a code the UI can turn into that instruction.
func identityError(profile string, err error) gin.H { return ErrorBody(profile, err) }

// ErrorBody is the JSON error for any call that failed on AWS credentials,
// with code "sso_expired" and the login command when that is the cause.
func ErrorBody(profile string, err error) gin.H {
	h := gin.H{"error": awsErrorMessage(err)}
	if isSSOExpired(err) {
		h["code"] = "sso_expired"
		cmd := "aws sso login"
		if profile != "" {
			cmd += " --profile " + profile
		}
		h["login_command"] = cmd
	}
	return h
}

func isSSOExpired(err error) bool {
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "sso") {
		return false
	}
	for _, s := range []string{"expired", "refresh cached", "invalid", "unauthorized", "token"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// awsErrorMessage keeps the useful first line of an SDK error without the
// request IDs and retry noise.
func awsErrorMessage(err error) string {
	msg := err.Error()
	if i := strings.Index(msg, "api error "); i >= 0 {
		return msg[i+len("api error "):]
	}
	return msg
}
