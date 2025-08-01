package main

import (
	"context"
	"flag"
	"os"
	"path/filepath"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	agentHelper "github.com/uc-cdis/gen3-admin/gen3-agent/helpers"
)

func init() {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to get home directory")
	}
	agentHelper.Kubeconfig = filepath.Join(homeDir, ".kube", "config")

	flag.StringVar(&agentHelper.AgentName, "name", "", "Name of the agent")
	flag.DurationVar(&agentHelper.StatusUpdateInterval, "status-interval", agentHelper.DefaultStatusUpdateInterval, "Interval for sending status updates")
	flag.StringVar(&agentHelper.GrpcServerURL, "server-address", agentHelper.DefaultGRPCServerURL, "Address of the GRPC server")
	flag.StringVar(&agentHelper.Kubeconfig, "kubeconfig", agentHelper.Kubeconfig, "Path to kubeconfig file")
	flag.Parse()

	if agentHelper.AgentName == "" {
		log.Fatal().Msg("Agent name is required")
	}

	agentHelper.AgentCertFile = "certs/" + agentHelper.AgentName + ".crt"
	agentHelper.AgentKeyFile = "certs/" + agentHelper.AgentName + ".key"
}

func main() {
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr})
	zerolog.SetGlobalLevel(zerolog.DebugLevel)
	log.Logger = log.With().Caller().Logger()

	agent, err := agentHelper.NewAgent(agentHelper.AgentName, "1.0.0", agentHelper.GrpcServerURL, agentHelper.StatusUpdateInterval)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to create agent")
	}

	ctx := context.Background()
	err = agent.Connect(ctx)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to connect to server")
	}

	log.Info().Msg("Agent connected and running")
	err = agent.Run(ctx)
	if err != nil {
		log.Fatal().Err(err).Msg("Agent encountered an error")
	}
}
