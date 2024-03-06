from fastapi import FastAPI

from jobs.main import router as jobs_router
from deployments.main import router as deployments_router
from systemservices.main import router as system_services
from cluster.main import router as cluster_router

app = FastAPI()

app.include_router(jobs_router, prefix="/jobs")
app.include_router(deployments_router, prefix="/deployments")
app.include_router(system_services, prefix="/system-services")
app.include_router(cluster_router, prefix="/cluster")


@app.get("/")
def read_root():
    url_list = [{"path": route.path, "name": route.name} for route in app.routes]
    return url_list
