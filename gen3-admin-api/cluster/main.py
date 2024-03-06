from fastapi import APIRouter
from kubernetes import client, config

# Configs can be set in Configuration class directly or using helper utility
config.load_kube_config()


router = APIRouter()


# Define a function to get k8s cluster version
@router.get("/version")
def get_cluster_version():
    version_api_instance = client.VersionApi()

    try:
        version_response = version_api_instance.get_code()
        version_string = f"{version_response.major}.{version_response.minor}"
        return version_string
    except Exception as e:
        print(
            "Exception when getting cluster version info %s\n" % e
        )
    return []