import { useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/router";

export function AuthenticatedLayout({ children }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Handle explicit session errors
    if (session?.error) {
      console.log('Session error detected, signing out:', session.error);
      signOut({ callbackUrl: '/' });
      return;
    }

    // Handle cases where session becomes null (token expired and couldn't refresh)
    if (status === "unauthenticated" && typeof window !== 'undefined') {
      const wasAuthenticated = sessionStorage.getItem('wasAuthenticated');
      if (wasAuthenticated) {
        console.log('Session lost due to token expiration, redirecting to sign in');
        sessionStorage.removeItem('wasAuthenticated');
        signOut({ callbackUrl: '/' });
      }
    }

    // Track authentication state
    if (status === "authenticated") {
      sessionStorage.setItem('wasAuthenticated', 'true');
    }
  }, [session?.error, status]);

  // Show loading state while checking authentication
  if (status === "loading") {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        width: '100vw',
      }}>
        <div className="spinner"></div>
        <style>
          {`
            .spinner {
              width: 40px;
              height: 40px;
              border: 4px solid rgba(0, 0, 0, 0.1);
              border-radius: 50%;
              border-left-color: #09f;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }

            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  // Redirect to sign in if not authenticated
  if (status === "unauthenticated") {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        width: '100vw',
      }}>
        <div className="spinner"></div>
        <style>
          {`
            .spinner {
              width: 40px;
              height: 40px;
              border: 4px solid rgba(0, 0, 0, 0.1);
              border-radius: 50%;
              border-left-color: #09f;
              animation: spin 1s linear infinite;
              margin: 20px auto;
            }

            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}
        </style>
      </div>
    );
  }

  return <>{children}</>;
}