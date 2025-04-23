import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabaseClient';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';
import { Session, User } from '@supabase/supabase-js';

// User cache key for localStorage
export const USER_CACHE_KEY = 'aditi_user_cache';

// Add a timestamp key to track last session check
export const LAST_SESSION_CHECK_KEY = 'aditi_last_session_check';

// Session check interval (reduced to 5 minutes for better UX)
const SESSION_CHECK_INTERVAL = 5 * 60 * 1000;

// Session validity tracking in memory
let GLOBAL_SESSION_VALID = false;
let GLOBAL_AUTH_INITIALIZED = false;

export type UserRole = 'user' | 'manager' | 'admin';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: string | null;
  signOut: () => Promise<void>;
  forceSessionRefresh: () => Promise<void>;
  refreshing: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  signOut: async () => {},
  forceSessionRefresh: async () => {},
  refreshing: false,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSessionCheckTime, setLastSessionCheckTime] = useState<number>(0);
  const [lastVisibilityState, setLastVisibilityState] = useState<string>('visible');
  const [sessionRestored, setSessionRestored] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [visibilityChangeCount, setVisibilityChangeCount] = useState(0);
  
  const router = useRouter();

  // Helper to set the last session check time
  const updateLastSessionCheckTime = () => {
    const now = Date.now();
    setLastSessionCheckTime(now);
    try {
      localStorage.setItem(LAST_SESSION_CHECK_KEY, now.toString());
    } catch (error) {
      console.error('Failed to save session check time:', error);
    }
  };

  // Force refresh session token
  const forceSessionRefresh = async () => {
    try {
      setRefreshing(true);
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw error;
      if (data?.session) {
        setSession(data.session);
        if (data.session.user) {
          setUser(data.session.user);
        }
        updateLastSessionCheckTime();
      }
    } catch (error) {
      console.error('Error refreshing session:', error);
      toast.error('Failed to refresh your session. Please login again.');
    } finally {
      setRefreshing(false);
    }
  };

  // Function to determine if we should perform a session check
  const shouldPerformSessionCheck = () => {
    // On initial load, always check
    if (isInitialLoad) return true;
    
    // Don't check if we checked recently
    const now = Date.now();
    let lastCheck = lastSessionCheckTime;
    
    // Try to get from localStorage for cross-tab consistency
    try {
      const storedLastCheck = localStorage.getItem(LAST_SESSION_CHECK_KEY);
      if (storedLastCheck) {
        lastCheck = parseInt(storedLastCheck, 10);
      }
    } catch (error) {
      console.error('Failed to read last session check time:', error);
    }
    
    // If we haven't checked in SESSION_CHECK_INTERVAL, check again
    return now - lastCheck > SESSION_CHECK_INTERVAL;
  };

  // Function to handle visibility change
  const handleVisibilityChange = async () => {
    // Skip if this is the first load
    if (isInitialLoad) return;
    
    // Track visibility changes
    setVisibilityChangeCount(prev => prev + 1);
    
    // Only do work when becoming visible
    if (document.visibilityState === 'visible' && lastVisibilityState === 'hidden') {
      // Mark this state change
      setLastVisibilityState('visible');
      
      // Should we check the session?
      if (shouldPerformSessionCheck()) {
        try {
          // Don't interrupt user flow, but quietly refresh in background
          const { data } = await supabase.auth.getSession();
          
          // Only update if we got valid data and it differs from current session
          if (data?.session && JSON.stringify(data.session) !== JSON.stringify(session)) {
            setSession(data.session);
            if (data.session.user) {
              setUser(data.session.user);
            }
          }
          
          // Update the last check time
          updateLastSessionCheckTime();
        } catch (error) {
          console.error('Error checking session on visibility change:', error);
        }
      }
    } else if (document.visibilityState === 'hidden') {
      // Mark that we're now hidden
      setLastVisibilityState('hidden');
    }
  };

  // Function to sign out
  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Error signing out');
    } finally {
      setLoading(false);
    }
  };

  // Initialize auth state and set up listeners
  useEffect(() => {
    let mounted = true;
    
    const initializeAuth = async () => {
      try {
        // Get the session
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (mounted) {
          if (data?.session) {
            setSession(data.session);
            setUser(data.session.user);
            
            // Get user role
            if (data.session?.user?.id) {
              const { data: userData, error: userError } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', data.session.user.id)
                .single();

              if (userError) throw userError;
              setUserRole(userData?.role || 'user');
            }
            
            setSessionRestored(true);
          } else {
            // No session
            setUser(null);
            setSession(null);
            setUserRole(null);
          }
          
          updateLastSessionCheckTime();
          setLoading(false);
          setIsInitialLoad(false);
        }
      } catch (error) {
        console.error('Error getting session:', error);
        if (mounted) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    };

    // Initialize auth on mount
    initializeAuth();

    // Listen for auth state changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, currentSession) => {
        if (mounted) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);

          if (currentSession?.user) {
            try {
              const { data, error } = await supabase
                .from('profiles')
                .select('role')
                .eq('id', currentSession.user.id)
                .single();

              if (error) throw error;
              setUserRole(data?.role || 'user');
            } catch (error) {
              console.error('Error getting user role:', error);
            }
          } else {
            setUserRole(null);
          }

          setLoading(false);
        }
      }
    );

    // Setup visibility change listener
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      mounted = false;
      authListener?.subscription?.unsubscribe();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        userRole,
        signOut,
        forceSessionRefresh,
        refreshing,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); 