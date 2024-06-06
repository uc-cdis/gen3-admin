from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from kubernetes import client, config
import os
from datetime import datetime

# Configs can be set in Configuration class directly or using helper utility
config.load_kube_config()

router = APIRouter()

appsv1 = client.AppsV1Api()
v1 = client.CoreV1Api()

# check if namespace var is set if not use default. This should be set by the pod.
namespace = os.getenv("NAMESPACE", "default")


####################
# Deployment Routes
####################
@router.get("/")
@router.get("")
def get_deployments():
    deps = appsv1.list_namespaced_deployment(namespace)
    return [
        {
            "name": dep.metadata.name,
            "replicas": dep.spec.replicas,
            "available": dep.status.available_replicas,
            "updated": dep.status.updated_replicas,
            "ready": dep.status.ready_replicas,
            "unavailable": dep.status.unavailable_replicas,
            "desired": dep.status.replicas,
            "image": dep.spec.template.spec.containers[0].image,
            "created": dep.metadata.creation_timestamp,
            # take the time now and subtract the creation time to get the age
            # "age": datetime.now() - dep.metadata.creation_timestamp,
            "now": datetime.now(),
            "labels": dep.metadata.labels,
            "details": f"/deployments/{dep.metadata.name}",
            "resources": [
                {
                    "name": cont.name, 
                    "limits": cont.resources.limits,
                    "requests": cont.resources.requests
                }
                for cont in dep.spec.template.spec.containers
            ],
        }
        for dep in deps.items
    ]


@router.get("/{name}")
def get_deployment(name: str):
    dep = appsv1.read_namespaced_deployment(name, namespace)
    # get pods for deployments
    dep_label = name.replace("-deployment", "")
    pods = v1.list_namespaced_pod(namespace, label_selector=f"app={dep_label}")
    # Get the metrics for all pods
    metrics_api = client.CustomObjectsApi()
    try:
        pods_metrics = metrics_api.list_cluster_custom_object("metrics.k8s.io", "v1beta1", "pods")
    except Exception as e:
        pods_metrics = None
    return {
        "name": dep.metadata.name,
        "replicas": dep.spec.replicas,
        "available": dep.status.available_replicas,
        "updated": dep.status.updated_replicas,
        "ready": dep.status.ready_replicas,
        "unavailable": dep.status.unavailable_replicas,
        "desired": dep.status.replicas,
        "created": dep.metadata.creation_timestamp,
        "labels": dep.metadata.labels,
        "pods": [
            {
                "name": pod.metadata.name,
                "status": pod.status.phase,
                "created": pod.metadata.creation_timestamp,
                "labels": pod.metadata.labels,
                "containers": [
                    {
                        "name": cont.name,
                        "image": cont.image,
                        "image_pull_policy": cont.image_pull_policy,
                        "limits": cont.resources.limits,
                        "logs": f"/deployments/logs/{pod.metadata.name}/{cont.name}",
                        "requests": cont.resources.requests,
                        "metrics": [] if not pods_metrics else [
                            {"usage": container["usage"], "timestamp": pod_m["timestamp"], "window": pod_m["window"]}
                            for pod_m in pods_metrics["items"]
                            if pod_m["metadata"]["name"] == pod.metadata.name
                            for container in pod_m["containers"]
                            if container["name"] == cont.name
                            if pods_metrics
                        ] 
                    }
                    for cont in pod.spec.containers
                ],
            }
            for pod in pods.items
        ],
    }
    

# kubectl logs -f <pod-name> -c <container-name>
@router.get("/logs/{pod_name}/{container_name}")
def get_logs(pod_name, container_name):
    try:
        logs = v1.read_namespaced_pod_log(pod_name, namespace, container=container_name, pretty=True)
        # return logs, split on new line
        def log_stream():
            for line in logs.split("\n"):
                yield line + "\n"

        return StreamingResponse(log_stream(), media_type="text/plain")
    
    except client.ApiException as e:
        raise HTTPException(status_code=e.status, detail=str(e))

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        return {"error": str(e)}


####################
# functions
####################
