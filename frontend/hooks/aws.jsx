import { useEffect, useState } from "react";

export function useAwsIdentity() {
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null); // local state

  const fetchIdentity = async () => {
    setLoading(true);
    setError(null);

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
  };

  useEffect(() => {
    fetchIdentity();
  }, []);

  // Function to call backend
  const updateProfile = async (profile) => {
    try {
      const res = await fetch("/api/aws/set-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData?.error || "Failed to set AWS profile");
      }

      // Optionally refetch identity after successful update
      await fetchIdentity();
    } catch (err) {
      console.error("Error updating AWS profile:", err);
      setError(err.message);
    }
  };

  // Local wrapper function: updates state immediately, then calls backend
  const selectProfile = async (profile) => {
    setSelectedProfile(profile); // update local state immediately
    await updateProfile(profile); // call backend
  };

  return {
    identity,
    loading,
    error,
    selectedProfile,
    selectProfile,
  };
}
