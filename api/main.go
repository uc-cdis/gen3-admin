// Setup MUX for API

package main

import (
	"os"

	"github.com/uc-cdis/gen3-admin/internal/server"
	"github.com/uc-cdis/gen3-admin/pkg/config"

	"github.com/joho/godotenv"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/rs/zerolog/pkgerrors"
)

// configureLogOutput selects human-readable console output for interactive use and
// structured JSON otherwise, so production logs can actually be ingested. Set
// LOG_FORMAT=console or LOG_FORMAT=json to override the auto-detection.
func configureLogOutput() {
	switch os.Getenv("LOG_FORMAT") {
	case "console":
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
		return
	case "json":
		// zerolog's default writer already emits JSON.
		return
	}

	// Auto-detect: a character device on stderr means a terminal.
	if info, err := os.Stderr.Stat(); err == nil && (info.Mode()&os.ModeCharDevice) != 0 {
		log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	}
}

func main() {
	zerolog.SetGlobalLevel(zerolog.InfoLevel)
	zerolog.ErrorStackMarshaler = pkgerrors.MarshalStack
	configureLogOutput()
	log.Logger = log.With().Caller().Logger()

	// Load the .env file
	// Ignore if it's not there, use regular env vars instead
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		log.Fatal().Err(err).Msg("Error loading .env file")
	}

	// Validate configuration before serving traffic. Without this, a bad
	// KEYCLOAK_URL/REALM only surfaces on the first authenticated request, so the
	// pod comes up healthy and then rejects every request.
	if err := config.Validate(); err != nil {
		log.Fatal().Err(err).Msg("invalid configuration")
	}

	// initialize agents from certs
	server.InitializeAgentsFromCerts()
	// db, err := initializeDatabase()
	// if err != nil {
	// 	log.Fatal().Err(err).Msg("Error initializing database")
	// 	return
	// }
	// defer db.Close()
	// ctx, cancel := context.WithCancel(context.Background())
	// defer cancel()

	server.SetupGRCPServer()
	server.SetupHTTPServer()

}
