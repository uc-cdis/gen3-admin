package utils

import (
	"os"

	"github.com/rs/zerolog/log"
)

func MustReadFile(filename string) []byte {
	data, err := os.ReadFile(filename)
	if err != nil {
		log.Fatal().Err(err).Msgf("Error reading file %s", filename)
	}
	return data
}

func MustWriteFile(filename string, data []byte, perm os.FileMode) {
	err := os.WriteFile(filename, data, perm)
	if err != nil {
		log.Fatal().Err(err).Msgf("Error writing file %s", filename)
	}
}
