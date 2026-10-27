package gitops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	awssdk "github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	smtypes "github.com/aws/aws-sdk-go-v2/service/secretsmanager/types"
)

// SecretsAPI is the part of the Secrets Manager client CSOC uses.
type SecretsAPI interface {
	CreateSecret(context.Context, *secretsmanager.CreateSecretInput, ...func(*secretsmanager.Options)) (*secretsmanager.CreateSecretOutput, error)
	PutSecretValue(context.Context, *secretsmanager.PutSecretValueInput, ...func(*secretsmanager.Options)) (*secretsmanager.PutSecretValueOutput, error)
	GetSecretValue(context.Context, *secretsmanager.GetSecretValueInput, ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

// appSecret is the github-app secret's JSON. ESO extracts each key into the
// ArgoCD repo-creds Secret, so the IDs are strings, as ArgoCD wants them.
type appSecret struct {
	AppID          string `json:"app_id"`
	InstallationID string `json:"installation_id"`
	PrivateKey     string `json:"private_key"`
}

// PutAppCredentials stores the App's credentials, creating the secret the
// first time and adding a new version after that.
func PutAppCredentials(ctx context.Context, api SecretsAPI, name, csoc string, creds AppCredentials) error {
	body, err := json.Marshal(appSecret{
		AppID:          strconv.FormatInt(creds.AppID, 10),
		InstallationID: strconv.FormatInt(creds.InstallationID, 10),
		PrivateKey:     string(creds.PrivateKey),
	})
	if err != nil {
		return err
	}
	_, err = api.PutSecretValue(ctx, &secretsmanager.PutSecretValueInput{SecretId: &name, SecretString: awssdk.String(string(body))})
	var nf *smtypes.ResourceNotFoundException
	if !errors.As(err, &nf) {
		return err
	}
	_, err = api.CreateSecret(ctx, &secretsmanager.CreateSecretInput{
		Name:         &name,
		Description:  awssdk.String("GitHub App that CSOC " + csoc + " and its ArgoCD use for the GitOps repo"),
		SecretString: awssdk.String(string(body)),
		Tags:         []smtypes.Tag{{Key: awssdk.String("gen3-csoc"), Value: &csoc}},
	})
	return err
}

// GetAppCredentials reads the App's credentials back for one use.
func GetAppCredentials(ctx context.Context, api SecretsAPI, name string) (AppCredentials, error) {
	out, err := api.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: &name})
	if err != nil {
		return AppCredentials{}, fmt.Errorf("read GitHub App key %s: %w", name, err)
	}
	var s appSecret
	if out.SecretString == nil || json.Unmarshal([]byte(*out.SecretString), &s) != nil {
		return AppCredentials{}, fmt.Errorf("secret %s is not a GitHub App credential", name)
	}
	appID, err1 := strconv.ParseInt(s.AppID, 10, 64)
	instID, err2 := strconv.ParseInt(s.InstallationID, 10, 64)
	if err1 != nil || err2 != nil || s.PrivateKey == "" {
		return AppCredentials{}, fmt.Errorf("secret %s is not a GitHub App credential", name)
	}
	return AppCredentials{AppID: appID, InstallationID: instID, PrivateKey: []byte(s.PrivateKey)}, nil
}
