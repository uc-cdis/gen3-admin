package aws

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const checkIPURL = "https://checkip.amazonaws.com"

// MyIPHandler reports the operator's public IP, the default entry in the
// CSOC ALB allowlist.
//
// On a laptop the API and the browser share an internet connection, so the
// API asks checkip. In-cluster the API's own egress IP is the cluster's NAT,
// not the operator's, so it reports the client address the ALB forwarded.
// GET /api/aws/my-ip
func MyIPHandler(c *gin.Context) {
	if os.Getenv("KUBERNETES_SERVICE_HOST") != "" {
		ip := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-For"), ",")[0])
		if ip == "" {
			ip = c.ClientIP()
		}
		respondIP(c, ip, "forwarded")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, checkIPURL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not reach " + checkIPURL})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64))
	respondIP(c, strings.TrimSpace(string(body)), "checkip")
}

func respondIP(c *gin.Context, ip, source string) {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() == nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not determine a public IPv4 address"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ip": parsed.String(), "cidr": parsed.String() + "/32", "source": source})
}
