from fastapi import APIRouter
from kubernetes import client, config

# Configs can be set in Configuration class directly or using helper utility
config.load_kube_config()


router = APIRouter()


batchv1 = client.BatchV1Api()

##########################################
####
####
####
####        FUNCTIONS THAT WILL BE MOVED LATER
####
############################################


# Define a function to get cronjobs from k8s and return them as a list
def get_all_cronjobs():
    try:
        api_response = batchv1.list_namespaced_cron_job(namespace="default")

        # Get the names of the cronjobs and return them as list.
        return api_response
    except Exception as e:
        print(
            "Exception when calling BatchV1beta1Api->list_namespaced_cron_job: %s\n" % e
        )
    return []


def get_cronjob(name):
    try:
        api_response = batchv1.read_namespaced_cron_job(name=name, namespace="default")
        return api_response
    except Exception as e:
        print(
            "Exception when calling BatchV1beta1Api->read_namespaced_cron_job: %s\n" % e
        )
    return []


def get_job(name):
    try:
        api_response = batchv1.read_namespaced_job(name=name, namespace="default")
        return api_response
    except Exception as e:
        print("Exception when calling BatchV1Api->read_namespaced_job: %s\n" % e)
    return []


def trigger_job_from_cron(job):
    # kubectl create job --from=cronjob/<job> <job-name>
    try:
        cronjob = get_cronjob(job)
        job = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                generate_name=f"{job}-",
                namespace="default",
                owner_references=[
                    client.V1OwnerReference(
                        api_version="batch/v1beta1",
                        block_owner_deletion=True,
                        controller=True,
                        kind="CronJob",
                        name=job,
                        uid=cronjob.metadata.uid,
                    )
                ],
            ),
            spec=cronjob.spec.job_template.spec,
        )

        job.metadata.name = job.metadata.name
        api_response = batchv1.create_namespaced_job(namespace="default", body=job)
        new_job_name = api_response.metadata.name
        print("Job triggered: %s\n" % new_job_name)
        return api_response
    except Exception as e:
        print("Exception when calling BatchV1Api->create_namespaced_job: %s\n" % e)
        raise e


# optional argument job name, if specifed return all jobs owned by that cronjob, if not specified return all jobs
def get_triggered_jobs(cronjob=None):
    # kubectl get jobs --selector=job-name=<job>
    try:
        api_response = batchv1.list_namespaced_job(
            namespace="default", label_selector="app=gen3job"
        )
        if cronjob:
            # Filter the list of jobs to only those owned by the cronjob
            api_response.items = [
                job
                for job in api_response.items
                if job.metadata.owner_references[0].name == cronjob
            ]
        return api_response if api_response.items else None
    except Exception as e:
        print("Exception when calling BatchV1Api->list_namespaced_job: %s\n" % e)
    return []


def get_pod_from_job(job):
    # kubectl get pods --selector=job-name=<job>
    try:
        api_response = client.CoreV1Api().list_namespaced_pod(
            namespace="default", label_selector=f"job-name={job}"
        )
        return api_response if api_response.items else None
    except Exception as e:
        print("Exception when calling CoreV1Api->list_namespaced_pod: %s\n" % e)
    return []


##########################################
####
####
####
####        END FUNCTIONS THAT WILL BE MOVED LATER
####
############################################

# -----------------------------------------------------------------------------------------------------------------

##########################################
####
####
####
####        ROUTES
####
############################################


@router.get("/options")
def list_cronjobs():
    # Call the function to get the list of gen3 cronjobs
    # If it errors, return a 500 error
    try:
        jobs = get_all_cronjobs()
        job_names = [{
            "name":job.metadata.name,
            "schedule":job.spec.schedule,
            "trigger": "/jobs/trigger/" + job.metadata.name,
            "instances": "/cron/status/" + job.metadata.name,
            "suspend": job.spec.suspend,
        } for job in jobs.items]
        return job_names
    except Exception as e:
        print("Exception when calling get_cronjobs: %s\n" % e)
        return {"status": "error", "message": e}, 500


@router.get("/trigger/{job}")
def trigger_job(job: str):
    try:
        triggered_job = trigger_job_from_cron(job)
        return {
            "job": triggered_job.metadata.name,
            "status": "/jobs/status/" + triggered_job.metadata.name
        }
    except Exception as e:
        print("Exception when calling trigger_job: %s\n" % e)
        return {"error": e}, 500


# Get a list of all jobs that have been triggered and their dates
@router.get("/status/all")
def list_all_triggered_jobs():
    # Call the function to get the list of gen3 cronjobs
    # If it errors, return a 500 error
    try:
        jobs = get_triggered_jobs()
        job_list = [
            {
                "name": job.metadata.name,
                "parent": job.metadata.owner_references[0].name,
                "status": "Succeeded"
                if job.status.succeeded
                else "Failed"
                if job.status.failed
                else "Running"
                if job.status.active
                else "Unknown",
                "date_created": job.metadata.creation_timestamp,
                "date_finished": job.status.completion_time,
                "details": "/jobs/status/" + job.metadata.name,
                # "containers": [
                #     {
                #         "name": container.name,
                #     } for container in job.spec.template.spec.containers]
            }
            for job in jobs.items
        ]
        # Sort list by date_created
        job_list.sort(key=lambda x: x["date_created"], reverse=True)
        return job_list
    except Exception as e:
        print("Exception when calling get_cronjobs: %s\n" % e)
        return {"status": "error", "message": e}, 500


@router.get("/status/{job}")
def job_status(job: str):
    try:
        job_details = get_job(job)
        pod_details = get_pod_from_job(job)
        return {
            "name": job_details.metadata.name,
            "parent": job_details.metadata.owner_references[0].name,
            "status": "Succeeded"
            if job_details.status.succeeded
            else "Failed"
            if job_details.status.failed
            else "Running"
            if job_details.status.active
            else "Unknown",
            "date_created": job_details.metadata.creation_timestamp,
            "date_finished": job_details.status.completion_time,
            "pod_name": pod_details.items[0].metadata.name if pod_details else None,
            "containers": [
                {
                    "name": container.name,
                    "image": container.image,
                    "state": {
                        k: v
                        for k, v in {
                            "running": {
                                "started_at": container.state.running.started_at,
                            }
                            if container.state.running
                            else None,
                            "waiting": {
                                "reason": container.state.waiting.reason,
                                "message": container.state.waiting.message,
                            }
                            if container.state.waiting
                            else None,
                            "terminated": {
                                "exit_code": container.state.terminated.exit_code,
                                "reason": container.state.terminated.reason,
                                "message": container.state.terminated.message,
                                "finished_at": container.state.terminated.finished_at,
                            }
                            if container.state.terminated
                            else None,
                        }.items()
                        if v is not None
                    },
                }
                for container in pod_details.items[0].status.container_statuses
            ],
            "events": [
                {
                    "type": event.type,
                    "status": event.status,
                    "reason": event.reason,
                    "message": event.message,
                    "time": event.last_transition_time,
                }
                for event in pod_details.items[0].status.conditions
            ]
            if pod_details
            else [],
        }
    except Exception as e:
        print("Exception when calling get_cronjobs: %s\n" % e)
        return {"status": "error", "message": e}, 500


# List all jobs status for a specific cronjob
@router.get("/cron/status/{job}")
def list_specific_triggered_jobs(job: str):
    # Call the function to get the list of gen3 cronjobs
    # If it errors, return a 500 error
    try:
        jobs = get_triggered_jobs(job)
        job_list = (
            [
                {
                    "name": job.metadata.name,
                    "status": "Succeeded"
                    if job.status.succeeded
                    else "Failed"
                    if job.status.failed
                    else "Running"
                    if job.status.active
                    else "Unknown",
                    "date_created": job.metadata.creation_timestamp,
                    "date_finished": job.status.completion_time,
                }
                for job in jobs.items
            ]
            if jobs
            else []
        )
        # Sort list by date_created
        job_list.sort(key=lambda x: x["date_created"], reverse=True)
        return job_list
    except Exception as e:
        print("Exception when calling list_specific_triggered_jobs: %s\n" % e)
        return {"status": "error", "message": e}, 500


##########################################
####
####
####
####        END ROUTES
####
############################################
