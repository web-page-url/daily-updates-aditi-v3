import { ReactNode, useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/authContext';
import LoadingSpinner from './LoadingSpinner';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

export default function ProtectedRoute({ children, allowedRoles = ['user', 'manager', 'admin'] }: ProtectedRouteProps) {
  const { user, loading, forceSessionRefresh } = useAuth();
  const router = useRouter();
  const [timeoutReached, setTimeoutReached] = useState(false);
  const [bypassProtection, setBypassProtection] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [visibilityState, setVisibilityState] = useState<'visible' | 'hidden'>(
    typeof document !== 'undefined' ? document.visibilityState as 'visible' | 'hidden' : 'visible'
  );
  const redirectInProgress = useRef(false);
  const mountedRef = useRef(true);

  // Track visibility changes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined') {
        setVisibilityState(document.visibilityState as 'visible' | 'hidden');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Track component mount state to prevent state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // If we already have a user and they have the correct role, don't do anything
    if (user && allowedRoles.includes(user.role as string)) {
      return;
    }

    // Set a safety timeout to prevent infinite loading
    const safetyTimeout = setTimeout(() => {
      if (!mountedRef.current) return;
      
      if (loading) {
        console.log('Protected route timeout reached, showing fallback UI');
        setTimeoutReached(true);
        
        // For dashboard routes, we'll allow rendering the children anyway
        // This helps admins and managers see the dashboard even with auth issues
        if (router.pathname === '/dashboard' || 
            router.pathname.includes('/team-management') || 
            router.pathname.includes('/admin')) {
          console.log('Bypassing protection for admin/manager route');
          setBypassProtection(true);
        } else if (retryCount < 2) {
          // For other routes, try to refresh the session token first before giving up
          console.log(`Attempting to refresh session (attempt ${retryCount + 1})`);
          
          forceSessionRefresh().then(() => {
            if (mountedRef.current) {
              // Reset timeout flag since we refreshed
              setTimeoutReached(false);
              setRetryCount(prev => prev + 1);
            }
          }).catch(() => {
            if (mountedRef.current) {
              // If refresh failed and we're still mounted, increment retry count
              setRetryCount(prev => prev + 1);
            }
          });
        }
      }
    }, 5000);

    // Handle auth state and redirects
    const handleAuthState = () => {
      // Only proceed if not already redirecting and the component is still mounted
      if (redirectInProgress.current || !mountedRef.current) return;

      // If authentication is done loading and there's no user, redirect to login
      if (!loading && !user) {
        redirectInProgress.current = true;
        router.replace('/').then(() => {
          if (mountedRef.current) {
            redirectInProgress.current = false;
          }
        });
      }
      
      // If user exists but doesn't have required role, redirect to appropriate page
      if (!loading && user && !allowedRoles.includes(user.role as string)) {
        redirectInProgress.current = true;
        
        // Redirect based on role
        let redirectPath = '/';
        switch(user.role) {
          case 'admin':
          case 'manager':
            redirectPath = '/dashboard';
            break;
          case 'user':
            redirectPath = '/user-dashboard';
            break;
        }
        
        router.replace(redirectPath).then(() => {
          if (mountedRef.current) {
            redirectInProgress.current = false;
          }
        });
      }
    };

    // Only perform auth checks and redirects when tab is visible
    if (visibilityState === 'visible' && !redirectInProgress.current) {
      handleAuthState();
    }

    return () => {
      clearTimeout(safetyTimeout);
    };
  }, [loading, user, router, allowedRoles, visibilityState, retryCount, forceSessionRefresh]);

  // If we've been loading too long and it's not an admin/manager route, redirect to login
  if (timeoutReached && !bypassProtection && retryCount >= 2) {
    console.log('Timeout reached on protected route, redirecting to login');
    
    // Only redirect if page is visible
    if (visibilityState === 'visible' && !redirectInProgress.current) {
      redirectInProgress.current = true;
      router.replace('/');
    }
    
    return <LoadingSpinner message="Redirecting to login..." />;
  }

  // If loading but we're bypassing protection for admin/manager routes, show the children
  if (loading && bypassProtection) {
    // If it's a dashboard route, allow rendering children anyway despite loading state
    console.log('Bypassing loading state for admin/manager route');
    return <>{children}</>;
  }

  // Still loading and not yet timed out, show spinner
  if (loading && !timeoutReached) {
    return <LoadingSpinner message="Checking permissions..." />;
  }

  // If not logged in or not authorized, and not bypassing, don't render children
  if ((!user || !allowedRoles.includes(user.role as string)) && !bypassProtection) {
    return <LoadingSpinner message="Redirecting..." />;
  }
  
  // User is authenticated and authorized (or we're bypassing)
  return <>{children}</>;
} 