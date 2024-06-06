


export  async function fetchCronJobs() {
    try {
        // Adjust the URL to match the proxied Kubernetes API endpoint for cronjobs
        // TODO: Configurable namespace
        const response = await fetch('/api/k8s/proxy/apis/batch/v1/namespaces/atharva/cronjobs');
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const data = await response.json();
        return data.items; // Assuming the Kubernetes API response structure
    } catch (error) {
        console.error('Failed to fetch cronjobs:', error);
        return [];
    }
}


export async function triggerCronJob(cronJobName) {
    try {
        // Fetch the cronjob to get the jobTemplate
        const cronJobResponse = await fetch(`/api/k8s/proxy/apis/batch/v1/namespaces/default/cronjobs/${cronJobName}`);
        if (!cronJobResponse.ok) {
            throw new Error(`Failed to fetch cronjob. HTTP status: ${cronJobResponse.status}`);
        }
        const cronJobData = await cronJobResponse.json();
        const jobTemplate = cronJobData.spec.jobTemplate;

        // Now create a job using the jobTemplate from the cronjob
        const jobResponse = await fetch(`/api/k8s/proxy/apis/batch/v1/namespaces/default/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                apiVersion: "batch/v1",
                kind: "Job",
                metadata: {
                    // Ensure that generateName is used to avoid naming conflicts
                    generateName: `${cronJobName}-job-`,
                    ownerReferences: [
                        {
                            apiVersion: "batch/v1",  // Make sure this matches the API version of the cronjob
                            kind: "CronJob",
                            name: cronJobName,
                            uid: cronJobData.metadata.uid,  // This assumes you have the uid from the fetched cronjob data
                            controller: true,
                            blockOwnerDeletion: true
                        }
                    ]        
                },
                spec: jobTemplate.spec // Using the spec from the cronjob's jobTemplate
            })
        });

        if (!jobResponse.ok) {
            throw new Error(`HTTP error! Status: ${jobResponse.status}`);
        }
        const jobResult = await jobResponse.json();
        return jobResult;
    } catch (error) {
        console.error('Failed to trigger job:', error);
        return null;
    }
}




export async function getJobInstances(cronJobName) {
    try {
        // First, fetch all jobs
        const responseAllJobs = await fetch('/api/k8s/proxy/apis/batch/v1/jobs');
        if (!responseAllJobs.ok) {
            throw new Error(`HTTP error! Status: ${responseAllJobs.status}`);
        }
        const allJobsData = await responseAllJobs.json();

        const jobs = allJobsData.items.filter(job => 
            job.metadata.ownerReferences && 
            job.metadata.ownerReferences.some(ref => ref.name === cronJobName)
        );

        return jobs;
    } catch (error) {
        console.error('API request failed:', error);
        return [];
    }
}

export async function getAllJobs() {
    try {
        // First, fetch all jobs
        const responseAllJobs = await fetch('/api/k8s/proxy/apis/batch/v1/jobs');
        if (!responseAllJobs.ok) {
            throw new Error(`HTTP error! Status: ${responseAllJobs.status}`);
        }
        const jobs = await responseAllJobs.json();


        return jobs;
    } catch (error) {
        console.error('API request failed:', error);
        return [];
    }
}


export async function getJobDetails(jobName) {
    try {
        // First, fetch all jobs
        // TODO: Make namespace dynamic to support multiple namespaces
        const responseAllJobs = await fetch('/api/k8s/proxy/apis/batch/v1/namespaces/default/jobs/' + jobName);
        if (!responseAllJobs.ok) {
            throw new Error(`HTTP error! Status: ${responseAllJobs.status}`);
        }
        console.log(responseAllJobs)
        const dataAllJobs = await responseAllJobs.json();
        const job = dataAllJobs

        return job;
    } catch (error) {
        console.error('API request failed:', error);
        return null;
    }
}