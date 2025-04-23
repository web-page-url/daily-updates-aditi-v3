import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from './supabaseClient';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';

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

interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId?: string;
  teamName?: string;
  lastChecked?: number;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  checkUserRole: () => Promise<UserRole>;
  refreshUser: () => Promise<void>;
  forceSessionRefresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(false); // Start with false to prevent initial loading flash
  const [visibilityChanged, setVisibilityChanged] = useState(false);
  const [sessionInitialized, setSessionInitialized] = useState(false);
  const router = useRouter();

  // Initialize user from localStorage if available
  useEffect(() => {
    // Track if this effect has run to prevent duplicate initialization
    if (GLOBAL_AUTH_INITIALIZED) return;
    GLOBAL_AUTH_INITIALIZED = true;

    // This prevents Vercel from showing loading spinner too early
    if (typeof window !== 'undefined') {
      try {
        const cachedUser = localStorage.getItem(USER_CACHE_KEY);
        if (cachedUser) {
          const parsedUser = JSON.parse(cachedUser);
          setUser(parsedUser);
          GLOBAL_SESSION_VALID = true;
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
      setSessionInitialized(true);
    }
    
    // Always force clear loading state after 3 seconds no matter what
    const safetyTimer = setTimeout(() => {
      if (isLoading) {
        console.log('SAFETY: Force clearing loading state');
        setIsLoading(false);
      }
      setSessionInitialized(true);
    }, 3000);
    
    return () => clearTimeout(safetyTimer);
  }, []);

  // Handle visibility change events with enhanced error handling for Vercel
  useEffect(() => {
    const handleVisibilityChange = () => {
      // Only trigger session check if document becomes visible AND was hidden before
      if (document.visibilityState === 'visible' && visibilityChanged) {
        try {
          // We don't need an immediate check if the user is already authenticated
          // Only check if the last check was more than the interval ago
          if (shouldPerformSessionCheck()) {
            checkSessionQuietly();
          }
          setVisibilityChanged(false);
        } catch (error) {
          console.error('Error in visibility change handler:', error);
          // Ensure loading state is cleared even if there's an error
          setIsLoading(false);
          setVisibilityChanged(false);
        }
      } else if (document.visibilityState === 'hidden') {
        setVisibilityChanged(true);
      }
    };

    // Add event listener for visibility change
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [visibilityChanged]);

  // Check if session check should be performed based on time since last check
  const shouldPerformSessionCheck = () => {
    try {
      // Check the in-memory flag first
      if (GLOBAL_SESSION_VALID && sessionInitialized) {
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
      if (event === 'SIGNED_IN' && session) {
        try {
          await updateUserData(session.user);
          GLOBAL_SESSION_VALID = true;
        } catch (error) {
          console.error('Error updating user data on sign in:', error);
          setIsLoading(false);
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
        GLOBAL_SESSION_VALID = false;
        
        if (router.pathname !== '/') {
          router.push('/');
        }
      } else if (event === 'TOKEN_REFRESHED') {
        // Session token was refreshed, update the valid flag
        GLOBAL_SESSION_VALID = true;
        localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, [router.pathname]);
  
  // Quiet session check without loading spinner - improved for Vercel
  const checkSessionQuietly = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      // Update last check timestamp
      localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
      setSessionInitialized(true);
      
      if (error) {
        console.error('Session check error:', error);
        GLOBAL_SESSION_VALID = false;
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
        return;
      }
      
      if (session && session.user) {
        updateUserData(session.user, false);
        GLOBAL_SESSION_VALID = true;
      } else if (!session && user) {
        // Only clear user if we have one set
        GLOBAL_SESSION_VALID = false;
        setUser(null);
        localStorage.removeItem(USER_CACHE_KEY);
      }
    } catch (error) {
      console.error('Error checking session:', error);
      setSessionInitialized(true);
    }
  };

  // Update user data from Supabase user
  const updateUserData = async (authUser: any, showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    
    try {
      if (!authUser?.email) {
        setUser(null);
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
      
      // Create user object
      const updatedUser = {
        id: authUser.id,
        email: authUser.email,
        name: authUser.user_metadata?.name || authUser.email.split('@')[0] || 'User',
        role,
        teamId,
        teamName,
        lastChecked: Date.now()
      };
      
      // Update state and cache
      setUser(updatedUser);
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(updatedUser));
      
    } catch (error) {
      console.error('Error updating user data:', error);
      setUser(null);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const refreshUser = async () => {
    try {
      setIsLoading(true);
      
      const { data: { user: authUser }, error } = await supabase.auth.getUser();
      
      if (error) {
        console.error('Error getting user:', error);
        setUser(null);
        GLOBAL_SESSION_VALID = false;
        return;
      }
      
      if (authUser) {
        await updateUserData(authUser);
        GLOBAL_SESSION_VALID = true;
      } else {
        setUser(null);
        GLOBAL_SESSION_VALID = false;
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
      setUser(null);
    } finally {
      setIsLoading(false);
      
      // Safety timeout to ensure loading state is cleared
      setTimeout(() => {
        if (isLoading) {
          console.log('Safety timeout clearing loading state in refreshUser');
          setIsLoading(false);
        }
      }, 1000);
    }
  };

  // Force refresh the session token - useful for handling 406 errors
  const forceSessionRefresh = async (): Promise<boolean> => {
    try {
      setIsLoading(true);
      
      // Try to refresh the session
      const { data, error } = await supabase.auth.refreshSession();
      
      if (error || !data.session) {
        console.error('Failed to refresh session:', error);
        // If refresh fails, sign out
        await signOut();
        return false;
      }
      
      // Update user data with the refreshed session
      await updateUserData(data.session.user);
      
      // Update our tracking variables
      GLOBAL_SESSION_VALID = true;
      localStorage.setItem(LAST_SESSION_CHECK_KEY, Date.now().toString());
      
      return true;
    } catch (error) {
      console.error('Error in force session refresh:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const checkUserRole = async (): Promise<UserRole> => {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      
      if (!authUser?.email) return 'user';
      
      // Check if admin
      const { data: adminData } = await supabase
        .from('aditi_admins')
        .select('*')
        .eq('email', authUser.email)
        .single();
      
      if (adminData) return 'admin';
      
      // Check if manager
      const { data: managerData } = await supabase
        .from('aditi_teams')
        .select('*')
        .eq('manager_email', authUser.email);
      
      if (managerData && managerData.length > 0) return 'manager';
      
      return 'user';
    } catch (error) {
      console.error('Error checking user role:', error);
      return 'user';
    }
  };

  const signOut = async () => {
    try {
      setIsLoading(true);
      await supabase.auth.signOut();
      setUser(null);
      localStorage.removeItem(USER_CACHE_KEY);
      GLOBAL_SESSION_VALID = false;
      toast.success('Successfully signed out');
      router.push('/');
    } catch (error) {
      console.error('Error signing out:', error);
      toast.error('Failed to sign out');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, checkUserRole, refreshUser, forceSessionRefresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 