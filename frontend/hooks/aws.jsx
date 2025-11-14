import { useEffect, useState } from "react";

export function useAwsIdentity() {
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchIdentity() {
      try {
        const res = await fetch("/api/aws/identity");
        if (!res.ok) throw new Error("Failed to fetch AWS identity");

        const data = await res.json();
        setIdentity(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchIdentity();
  }, []);

  return { identity, loading, error };
}
