// Setup MUX for API

package main

import (
	"os"

	_ "github.com/mattn/go-sqlite3"
	"github.com/uc-cdis/gen3-admin/internal/agent"

	"github.com/joho/godotenv"

	_ "net/http/pprof"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/rs/zerolog/pkgerrors"
)

// const saTemplate = `---
// apiVersion: v1
// kind: ServiceAccount
// metadata:
//   name: csoc
//   namespace: csoc
// {{- if .EKS }}
//   annotations:
//     eks.amazonaws.com/role-arn: {{ .RoleARN }}
// {{- end }}
// `

func main() {
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	zerolog.ErrorStackMarshaler = pkgerrors.MarshalStack
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	log.Logger = log.With().Caller().Logger()

	// Load the .env file
	// Ignore if it's not there, use regular env vars instead
	err := godotenv.Load()
	if err != nil {
		if err != nil && !os.IsNotExist(err) {
			log.Fatal().Err(err).Msg("Error loading .env file")
		}
	}

	// initialize agents from certs
	agent.InitializeAgentsFromCerts()
	// db, err := initializeDatabase()
	// if err != nil {
	// 	log.Fatal().Err(err).Msg("Error initializing database")
	// 	return
	// }
	// defer db.Close()
	// ctx, cancel := context.WithCancel(context.Background())
	// defer cancel()

	agent.SetupGRCPServer()
	agent.SetupHTTPServer()

}
