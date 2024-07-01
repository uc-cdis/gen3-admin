import callK8sApi  from '@/lib/k8s';


export  async function fetchCronJobs() {
    try {
        // TODO: Configurable namespace
        const namespace = "default"
        const data = await callK8sApi(`/apis/batch/v1/namespaces/${namespace}/cronjobs`)
        return data.items; // Assuming the Kubernetes API response structure
    } catch (error) {
        console.error('Failed to fetch cronjobs:', error);
        return [];
    }
}


export async function triggerCronJob(cronJobName) {
    try {
        // Fetch the cronjob to get the jobTemplate
        const cronJobData = await callK8sApi(`/apis/batch/v1/namespaces/default/cronjobs/${cronJobName}`)
        const jobTemplate = cronJobData.spec.jobTemplate;

        const body = {
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
        }
        console.log(body)
        const jobResult = await callK8sApi('/apis/batch/v1/namespaces/default/jobs', "POST", body)
        return jobResult;
    } catch (error) {
        console.error('Failed to trigger job:', error);
        throw error
    }
}




export async function getJobInstances(cronJobName) {
    try {
        const allJobsData = await callK8sApi('/apis/batch/v1/jobs')

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
        const jobs = await callK8sApi('/apis/batch/v1/jobs')
        return jobs;
    } catch (error) {
        console.error('API request failed:', error);
        return [];
    }
}


export async function getJobDetails(jobName) {
    try {
        // TODO: Make namespace dynamic to support multiple namespaces
        const job = await callK8sApi('/apis/batch/v1/namespaces/default/jobs/' + jobName)
        return job;
    } catch (error) {
        console.error('API request failed:', error);
        return null;
    }
}