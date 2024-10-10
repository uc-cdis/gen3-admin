import clientGen3Query from '@/utils/clientGen3Query';

import AuthContext from '@/contexts/auth';
import { useContext, useEffect, useState } from 'react';


export default function Sheepdog() {

  const {url, token} = useContext(AuthContext);
  console.log("token in sheepdog", token, url) 
  const [programs, setPrograms] = useState([]);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);



  useEffect(() => {
    if (!token && !url) {
      return; 
    }
    console.log(url, token)
    async function fetchData() {
      try {
        // Example: Fetching programs
        const fullUrl = new URL(url).origin
        console.log("fullurl", fullUrl)
        const programs = await clientGen3Query(fullUrl, '/api/v0/submission/', 'GET', null, token);
        console.log("query")
        setData(programs.links);
      } catch (err) {
        setError('Failed to fetch data');
        console.error(err);
      }
    }

    fetchData();
  }, [url, token]);


  if (!data) {
    return (<>
    null</>)
  }

  return (
    <div>
      <h2>Programs:</h2>
      <ul>
        {Object?.entries(data).map(([programName, programDetails]) => (
          <li key={programName}>{programName}: {JSON.stringify(programDetails)}</li>
        ))}
      </ul>
    </div>

  )
}