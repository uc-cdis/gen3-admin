from kubernetes import client, config
from fastapi import APIRouter


# Configs can be set in Configuration class directly or using helper utility
config.load_kube_config()

router = APIRouter()

appsv1 = client.AppsV1Api()
v1 = client.CoreV1Api()

# check if namespace var is set if not use default. This should be set by the pod.
namespace = os.getenv("NAMESPACE", "default")
