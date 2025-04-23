import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { supabase } from './supabaseClient';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';
import { Session, User as SupabaseUser } from '@supabase/supabase-js';

// User cache key for localStorage
export const USER_CACHE_KEY = 'aditi_user_cache';

// Add a timestamp key to track last session check
export const LAST_SESSION_CHECK_KEY = 'aditi_last_session_check';

// Session check interval (set to much longer - once per day)
const SESSION_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

// Token validity period (100 years to make it effectively permanent)
const TOKEN_VALIDITY_PERIOD = 3153600000000; // 100 years in milliseconds

// Session validity tracking in memory
let GLOBAL_SESSION_VALID = false;
let GLOBAL_AUTH_INITIALIZED = false;

// Track if we're currently changing pages to prevent unnecessary checks
let NAVIGATION_IN_PROGRESS = false;

export type UserRole = 'user' | 'manager' | 'admin';

// Custom User type that extends Supabase User
export interface User extends SupabaseUser {
  role?: UserRole;
  teamId?: string;
  teamName?: string;
  lastChecked?: number;
  name?: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isLoading: boolean; // Alias for loading to maintain compatibility
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  initialized: boolean;
  forceSessionRefresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const router = useRouter();
  const visibilityChangedRef = useRef(false);
  const isMountedRef = useRef(true);

  // Track component mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Track router events to prevent unnecessary auth checks during navigation
  useEffect(() => {
    const handleRouteChangeStart = () => {
      NAVIGATION_IN_PROGRESS = true;
      // Store in sessionStorage to persist across page loads
      sessionStorage.setItem('navigation_in_progress', 'true');
    };

    const handleRouteChangeComplete = () => {
      NAVIGATION_IN_PROGRESS = false;
      sessionStorage.removeItem('navigation_in_progress');
    };

    router.events.on('routeChangeStart', handleRouteChangeStart);
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    router.events.on('routeChangeError', handleRouteChangeComplete);

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
      router.events.off('routeChangeError', handleRouteChangeComplete);
    };
  }, [router]);

  // Initialize user from localStorage if available
  useEffect(() => {
    // Track if this effect has run to prevent duplicate initialization
    if (GLOBAL_AUTH_INITIALIZED) return;
    GLOBAL_AUTH_INITIALIZED = true;

    // Check if we're resuming from navigation and restore navigation state if so
    if (typeof window !== 'undefined' && sessionStorage.getItem('navigation_in_progress') === 'true') {
      NAVIGATION_IN_PROGRESS = true;
    }

    // This prevents Vercel from showing loading spinner too early
    if (typeof window !== 'undefined') {
      try {
        const cachedUser = localStorage.getItem(USER_CACHE_KEY);
        if (cachedUser) {
          const parsedUser = JSON.parse(cachedUser);
          setUser(parsedUser);
          GLOBAL_SESSION_VALID = true;
          
          // Extend the user's lastChecked timestamp
          if (parsedUser) {
            parsedUser.lastChecked = Date.now();
            localStorage.setItem(USER_CACHE_KEY, JSON.stringify(parsedUser));
          }
          
          // Extend the session token validity if we have one
          try {
            const tokenStr = localStorage.getItem('supabase.auth.token');
            if (tokenStr) {
              const token = JSON.parse(tokenStr);
              if (token) {
                // Update token expiry to 1 year
                token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
                token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
                localStorage.setItem('supabase.auth.token', JSON.stringify(token));
              }
            }
          } catch (e) {
            console.error('Error extending token lifetime:', e);
          }
        }
      } catch (error) {
        console.error('Error loading cached user:', error);
      }
    }
    
    // Only check session if necessary (not checked recently)
    const shouldCheckSession = shouldPerformSessionCheck();
    if (shouldCheckSession) {
      checkSessionQuietly();
    } else {
      setInitialized(true);
    }
    
    // Always force clear loading state after 3 seconds no matter what
    const safetyTimer = setTimeout(() => {
      if (loading && isMountedRef.current) {
        console.log('SAFETY: Force clearing loading state');
        setLoading(false);
      }
      if (isMountedRef.current) {
        setInitialized(true);
      }
    }, 3000);
    
    return () => clearTimeout(safetyTimer);
  }, []);

  // Handle visibility change events with enhanced error handling for Vercel
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Skip visibility checks during navigation
      if (NAVIGATION_IN_PROGRESS) {
        console.log('Skipping visibility check during navigation');
        return;
      }
      
      // Only trigger session check if document becomes visible AND was hidden before
      if (document.visibilityState === 'visible' && visibilityChangedRef.current) {
        try {
          // Always extend token validity when tab becomes visible
          try {
            const tokenStr = localStorage.getItem('supabase.auth.token');
            if (tokenStr) {
              const token = JSON.parse(tokenStr);
              if (token) {
                // Update token expiry to 1 year
                token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
                token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
                localStorage.setItem('supabase.auth.token', JSON.stringify(token));
                console.log('Extended token lifetime on tab visibility change');
              }
            }
          } catch (e) {
            console.error('Error extending token lifetime:', e);
          }
          
          // We don't need session checks on tab switch - this causes refreshes
          // if (shouldPerformSessionCheck()) {
          //   checkSessionQuietly();
          // }
          visibilityChangedRef.current = false;
        } catch (error) {
          console.error('Error in visibility change handler:', error);
          // Ensure loading state is cleared even if there's an error
          if (isMountedRef.current) {
            setLoading(false);
            visibilityChangedRef.current = false;
          }
        }
      } else if (document.visibilityState === 'hidden') {
        visibilityChangedRef.current = true;
      }
    };

    // Add event listener for visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Periodically extend token validity to prevent expiry (runs every 30 minutes)
  useEffect(() => {
    // Initial extension
    extendTokenValidity();
    
    const intervalId = setInterval(() => {
      if (user) {
        extendTokenValidity();
      }
    }, 30 * 60 * 1000); // Every 30 minutes
    
    return () => clearInterval(intervalId);
  }, [user]);
  
  // Function to extend token validity
  const extendTokenValidity = () => {
    try {
      // Extend user's lastChecked timestamp
      if (user) {
        const updatedUser = {
          ...user,
          lastChecked: Date.now()
        };
        setUser(updatedUser);
        localStorage.setItem(USER_CACHE_KEY, JSON.stringify(updatedUser));
      }
      
      // Extend the session token validity
      const tokenStr = localStorage.getItem('supabase.auth.token');
      if (tokenStr) {
        const token = JSON.parse(tokenStr);
        if (token) {
          // Update token expiry to 1 year
          token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
          token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
          localStorage.setItem('supabase.auth.token', JSON.stringify(token));
          localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
          console.log('Extended token validity through periodic check');
        }
      }
    } catch (e) {
      console.error('Error extending token validity:', e);
    }
  };

  // Check if session check should be performed based on time since last check
  const shouldPerformSessionCheck = () => {
    try {
      // Skip checks during navigation
      if (NAVIGATION_IN_PROGRESS) {
        return false;
      }
      
      // Check the in-memory flag first
      if (GLOBAL_SESSION_VALID && initialized) {
        return false;
      }

      const lastCheckStr = localStorage.getItem(LAST_SESSION_CHECK_KEY);
      if (!lastCheckStr) return true;
      
      const lastCheck = parseInt(lastCheckStr, 10);
      const now = Date.now();
      
      // If last check was more than interval ago, we should check again
      return (now - lastCheck) > SESSION_CHECK_INTERVAL;
    } catch (error) {
      console.error('Error checking last session time:', error);
      return true;
    }
  };

  // Set up auth state listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Skip auth state changes during navigation
      if (NAVIGATION_IN_PROGRESS) {
        console.log('Skipping auth state change during navigation:', event);
        return;
      }
      
      if (event === 'SIGNED_IN' && session) {
        try {
          await updateUserData(session.user);
          GLOBAL_SESSION_VALID = true;
          
          // Extend token validity on sign in
          try {
            const tokenStr = localStorage.getItem('supabase.auth.token');
            if (tokenStr) {
              const token = JSON.parse(tokenStr);
              if (token) {
                // Update token expiry to 1 year
                token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
                token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
                localStorage.setItem('supabase.auth.token', JSON.stringify(token));
              }
            }
          } catch (e) {
            console.error('Error extending token lifetime on sign in:', e);
          }
        } catch (error) {
          console.error('Error updating user data on sign in:', error);
          if (isMountedRef.current) {
            setLoading(false);
          }
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
        GLOBAL_SESSION_VALID = false;
        
        if (router.pathname !== '/') {
          router.push('/');
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // Session token was refreshed, update the valid flag and extend validity
        GLOBAL_SESSION_VALID = true;
        localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
        
        // Extend token validity on refresh
        try {
          const tokenStr = localStorage.getItem('supabase.auth.token');
          if (tokenStr) {
            const token = JSON.parse(tokenStr);
            if (token) {
              // Update token expiry to 1 year
              token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
              token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
              localStorage.setItem('supabase.auth.token', JSON.stringify(token));
            }
          }
        } catch (e) {
          console.error('Error extending token lifetime on refresh:', e);
        }
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [router.pathname]);
  
  // Quiet session check without loading spinner - improved for Vercel
  const checkSessionQuietly = async () => {
    try {
      if (NAVIGATION_IN_PROGRESS) {
        console.log('Skipping session check during navigation');
        return;
      }
      
      const { data: { session }, error } = await supabase.auth.getSession();
      
      // Update last check timestamp
      localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
      setInitialized(true);
      
      if (error) {
        console.error('Session check error:', error);
        // Don't clear user on error - try to preserve session if possible
        return;
      }
      
      if (session && session.user) {
        updateUserData(session.user, false);
        GLOBAL_SESSION_VALID = true;
        
        // Extend token validity on session check
        try {
          const tokenStr = localStorage.getItem('supabase.auth.token');
          if (tokenStr) {
            const token = JSON.parse(tokenStr);
            if (token) {
              // Update token expiry to 1 year
              token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
              token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
              localStorage.setItem('supabase.auth.token', JSON.stringify(token));
            }
          }
        } catch (e) {
          console.error('Error extending token lifetime on session check:', e);
        }
      } else if (!session && user && !NAVIGATION_IN_PROGRESS) {
        // Only clear user if we're not navigating
        // This prevents clearing user during page transitions
        console.log('No active session found, but trying to preserve state during navigation');
      }
    } catch (error) {
      console.error('Error checking session:', error);
      if (isMountedRef.current) {
        setInitialized(true);
      }
    }
  };

  // Update user data from Supabase user
  const updateUserData = async (authUser: any, showLoading = true) => {
    if (showLoading && isMountedRef.current) {
      setLoading(true);
    }
    
    try {
      if (!authUser?.email) {
        if (isMountedRef.current) {
          setUser(null);
        }
        return;
      }
      
      // Get user role
      let role: UserRole = 'user';
      
      try {
        // Check if admin
        const { data: adminData } = await supabase
          .from('aditi_admins')
          .select('*')
          .eq('email', authUser.email)
          .single();
        
        if (adminData) {
          role = 'admin';
        } else {
          // Check if manager
          const { data: managerData } = await supabase
            .from('aditi_teams')
            .select('*')
            .eq('manager_email', authUser.email);
          
          if (managerData && managerData.length > 0) {
            role = 'manager';
          }
        }
      } catch (error) {
        console.error('Error checking user role:', error);
      }
      
      // Get team info
      let teamId = undefined;
      let teamName = undefined;
      
      try {
        const { data: userData } = await supabase
          .from('aditi_team_members')
          .select('*, aditi_teams(*)')
          .eq('employee_email', authUser.email)
          .single();
        
        if (userData) {
          teamId = userData.team_id;
          teamName = userData.aditi_teams?.team_name;
        }
      } catch (error) {
        console.error('Error getting user team info:', error);
      }
      
      // Create user object with all required Supabase User properties
      const updatedUser: User = {
        ...authUser, // Include all original properties from authUser
        // Override or add custom properties
        name: authUser.user_metadata?.name || authUser.email.split('@')[0] || 'User',
        role,
        teamId,
        teamName,
        lastChecked: Date.now()
      };
      
      // Update state and cache
      if (isMountedRef.current) {
        setUser(updatedUser);
      }
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(updatedUser));
      
    } catch (error) {
      console.error('Error updating user data:', error);
      if (isMountedRef.current) {
        setUser(null);
      }
    } finally {
      if (showLoading && isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    } catch (error) {
      console.error('Error signing in:', error);
      return { error };
    }
  };

  const signOut = async () => {
    try {
      if (isMountedRef.current) {
        setLoading(true);
      }
      await supabase.auth.signOut();
      if (isMountedRef.current) {
        setUser(null);
      }
      localStorage.removeItem(USER_CACHE_KEY);
      GLOBAL_SESSION_VALID = false;
      toast.success('Successfully signed out');
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  };

  const forceSessionRefresh = async () => {
    try {
      // Skip if navigation is in progress
      if (NAVIGATION_IN_PROGRESS) {
        console.log('Skipping force session refresh during navigation');
        return true;
      }
      
      // Just extend token validity - no need to check with server
      extendTokenValidity();
      
      // Set session valid flag
      GLOBAL_SESSION_VALID = true;
      
      // Try to get user from localStorage if not already available
      if (!user) {
        try {
          const cachedUser = localStorage.getItem(USER_CACHE_KEY);
          if (cachedUser) {
            const parsedUser = JSON.parse(cachedUser);
            setUser(parsedUser);
          }
        } catch (error) {
          console.error('Error loading cached user during force refresh:', error);
        }
      }
      
      // Mark as initialized
      setInitialized(true);
      
      return true;
    } catch (error) {
      console.error('Error forcing session refresh:', error);
      return false;
    }
  };

  const value = {
    user,
    session,
    loading,
    isLoading: loading,
    signIn,
    signOut,
    initialized,
    forceSessionRefresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 