package psql

import (
	"context"
	"log"

	"github.com/uc-cdis/gen3-admin/pkg/config"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	// _ "github.com/lib/pq"
)

type psql struct {
	name     string `json:"name"`
	username string `json:"username"`
	host     string `json:"host"`
}

// Get secrets from k8s that are named *-dbcreds and present that as possible psqls to connect to.

func GetDBSecrets() []psql {
	// get secrets from k8s

	// get clientset
	client, namespace, err := config.K8sClient()
	if err != nil {
		log.Fatal(err)
	}

	// list secrets
	secrets, err := client.CoreV1().Secrets(*namespace).List(context.TODO(), metav1.ListOptions{})
	if err != nil {
		log.Fatal(err)
	}

	retSecret := []psql{}

	// loop over each secret
	for _, secret := range secrets.Items {
		// log.Println(secret)
		// if secret.Name.Contains("-dbcreds") {
		if len(secret.Name) > 8 && secret.Name[len(secret.Name)-8:] == "-dbcreds" {
			// secret.Name but without -dbcreds
			name := secret.Name[:len(secret.Name)-8]

			username := string(secret.Data["username"])
			host := string(secret.Data["host"])

			// create a psql struct
			p := psql{name: name, username: username, host: host}

			// add to struct

			// append the name to the list
			retSecret = append(retSecret, p)
		}
	}
	// for each secret, if it has a name that ends with -dbcreds, add it to the list
	// return the list
	return retSecret
}
