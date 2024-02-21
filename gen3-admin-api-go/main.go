// Setup MUX for API

package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/uc-cdis/gen3-admin/gen3admin"
	"go.uber.org/zap"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync() // flushes buffer, if any
	sugar := logger.Sugar()
	sugar.Debug("Setting up MUX for API")

	// mux := http.NewServeMux()
	// // hatchery.RegisterSystem(mux)
	// // hatchery.RegisterHatchery(mux)

	// // config.Logger.Printf("Running main")
	// logger.Info("Running main on port 8001")
	// log.Fatal(http.ListenAndServe("0.0.0.0:8001", mux))

	// uncomment the following to run the gin server
	r := gin.Default()
	r.Static("/static", "./static")

	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"message": "pong",
		})
	})

	gin.Logger()

	gen3admin.Routes(r)

	r.Run() // listen and serve on 0.0.0.0:8080 (for windows "localhost:8080")

	// just run the execIntoPod function
	// gen3admin.ExecIntoPod()

}
