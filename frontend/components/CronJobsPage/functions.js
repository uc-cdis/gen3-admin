import callK8sApi from '@/lib/k8s';

export async function fetchCronJobs(clusterName, namespace, accessToken) {
  try {
    const endpoint = namespace && namespace !== ''
      ? `/apis/batch/v1/namespaces/${namespace}/cronjobs`
      : `/apis/batch/v1/cronjobs`;

    const data = await callK8sApi(endpoint, 'GET', null, {}, clusterName, accessToken);
    return data.items;
  } catch (error) {
    console.error('Failed to fetch cronjobs:', error);
    return [];
  }
}

export async function triggerCronJob(cronJobName, namespace, clusterName, accessToken) {
  if (!namespace) {
    throw new Error('Namespace must be specified to trigger a job.');
  }

  try {
    const cronJobData = await callK8sApi(
      `/apis/batch/v1/namespaces/${namespace}/cronjobs/${cronJobName}`,
      'GET',
      null,
      {},
      clusterName,
      accessToken
    );

    const jobTemplate = cronJobData.spec.jobTemplate;

    const body = {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: {
        generateName: `${cronJobName}-job-`,
        ownerReferences: [{
          apiVersion: 'batch/v1',
          kind: 'CronJob',
          name: cronJobName,
          uid: cronJobData.metadata.uid,
          controller: true,
          blockOwnerDeletion: true
        }]
      },
      spec: jobTemplate.spec
    };

    return await callK8sApi(
      `/apis/batch/v1/namespaces/${namespace}/jobs`,
      'POST',
      body,
      {},
      clusterName,
      accessToken
    );
  } catch (error) {
    console.error('Failed to trigger job:', error);
    throw error;
  }
}

export async function getJobInstances(cronJobName, namespace, clusterName, accessToken) {
  try {
    const endpoint = namespace && namespace !== ''
      ? `/apis/batch/v1/namespaces/${namespace}/jobs`
      : `/apis/batch/v1/jobs`;

    const allJobsData = await callK8sApi(endpoint, 'GET', null, {}, clusterName, accessToken);

    const jobs = allJobsData.items.filter(job =>
      job.metadata.ownerReferences &&
      job.metadata.ownerReferences.some(ref => ref.name === cronJobName)
    );

    return jobs;
  } catch (error) {
    console.error('Failed to fetch job instances:', error);
    return [];
  }
}

export async function getAllJobs(clusterName, namespace, accessToken) {
  try {
    const endpoint = namespace && namespace !== ''
      ? `/apis/batch/v1/namespaces/${namespace}/jobs`
      : `/apis/batch/v1/jobs`;

    const jobs = await callK8sApi(endpoint, 'GET', null, {}, clusterName, accessToken);
    return jobs;
  } catch (error) {
    console.error('Failed to fetch jobs:', error);
    return [];
  }
}

export async function getJobDetails(jobName, namespace, clusterName, accessToken) {
  try {
    if (!namespace) {
      throw new Error('Namespace is required to get job details.');
    }

    const endpoint = `/apis/batch/v1/namespaces/${namespace}/jobs/${jobName}`;
    const job = await callK8sApi(endpoint, 'GET', null, {}, clusterName, accessToken);
    return job;
  } catch (error) {
    console.error('Failed to fetch job details:', error);
    return null;
  }
}
