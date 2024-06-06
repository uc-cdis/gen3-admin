from fastapi import APIRouter, HTTPException

router = APIRouter()

from kubernetes import client, config

####################
# system services Routes
####################
@router.get("/")
def hello():
    # Get pod with label arborist and the print the names
    config.load_kube_config()
    v1 = client.CoreV1Api()
    ret = v1.list_pod_for_all_namespaces(label_selector="app=arborist")
    for i in ret.items:
        print("%s\t%s\t%s" % (i.status.pod_ip, i.metadata.namespace, i.metadata.name))
    return "hello world"