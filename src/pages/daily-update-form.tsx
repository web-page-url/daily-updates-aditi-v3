import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import { supabase, DailyUpdate, Team } from '../lib/supabaseClient';
import { useAuth } from '../lib/authContext';
import ProtectedRoute from '../components/ProtectedRoute';
import { useRouter } from 'next/router';
import { toast } from 'react-hot-toast';
import debounce from 'lodash/debounce';
import Script from 'next/script';

// Constants for localStorage keys
const FORM_DATA_STORAGE_KEY = 'aditi_daily_update_form_data';
const BLOCKERS_STORAGE_KEY = 'aditi_daily_update_blockers';
const SELECTED_TEAM_STORAGE_KEY = 'aditi_daily_update_selected_team';
const CURRENT_BLOCKER_STORAGE_KEY = 'aditi_daily_update_current_blocker';
const TAB_STATE_PERSISTENCE_KEY = 'aditi_daily_update_tab_state';
const FORM_LOADED_KEY = 'aditi_form_loaded_time';

interface Blocker {
  id: string;
  type: 'Blockers' | 'Risks' | 'Dependencies';
  description: string;
  expected_resolution_date: string;
}

export default function DailyUpdateFormPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [formData, setFormData] = useState({
    employee_name: '',
    employee_id: '',
    email_address: '',
    tasks_completed: '',
    status: 'in-progress',
    additional_notes: '',
  });
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [showBlockerForm, setShowBlockerForm] = useState(false);
  const [currentBlocker, setCurrentBlocker] = useState<Partial<Blocker>>({
    type: 'Blockers',
    description: '',
    expected_resolution_date: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAnimation, setShowAnimation] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  
  // Refs to track tab visibility state and prevent refresh
  const wasHidden = useRef(false);
  const tabFocusCount = useRef(0);
  const initialLoadComplete = useRef(false);
  const formStateInitialized = useRef(false);
  const mountTime = useRef(Date.now());

  // Debounced save function to prevent excessive localStorage writes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce((key: string, data: any) => {
      try {
        setAutoSaveStatus('saving');
        localStorage.setItem(key, JSON.stringify(data));
        setAutoSaveStatus('saved');
        
        // Reset status after 2 seconds
        setTimeout(() => {
          if (autoSaveStatus === 'saved') {
            setAutoSaveStatus('idle');
          }
        }, 2000);
      } catch (error) {
        console.error(`Error saving ${key} to localStorage:`, error);
        setAutoSaveStatus('error');
      }
    }, 300),
    [autoSaveStatus]
  );

  // Function to save all form data
  const saveAllFormData = useCallback(() => {
    if (!formData.email_address || isSubmitting) return;

    try {
      setAutoSaveStatus('saving');
      localStorage.setItem(FORM_DATA_STORAGE_KEY, JSON.stringify(formData));
      localStorage.setItem(BLOCKERS_STORAGE_KEY, JSON.stringify(blockers));
      if (selectedTeam) {
        localStorage.setItem(SELECTED_TEAM_STORAGE_KEY, selectedTeam);
      }
      localStorage.setItem(CURRENT_BLOCKER_STORAGE_KEY, JSON.stringify(currentBlocker));
      setAutoSaveStatus('saved');
      
      // Reset status after 2 seconds
      setTimeout(() => {
        if (autoSaveStatus === 'saved') {
          setAutoSaveStatus('idle');
        }
      }, 2000);
    } catch (error) {
      console.error('Error saving form data to localStorage:', error);
      setAutoSaveStatus('error');
    }
  }, [formData, blockers, selectedTeam, currentBlocker, isSubmitting, autoSaveStatus]);

  // Load form data from localStorage when component mounts or user changes
  useEffect(() => {
    if (user) {
      try {
        // Try to load saved form data
        const savedFormData = localStorage.getItem(FORM_DATA_STORAGE_KEY);
        const savedBlockers = localStorage.getItem(BLOCKERS_STORAGE_KEY);
        const savedSelectedTeam = localStorage.getItem(SELECTED_TEAM_STORAGE_KEY);
        const savedCurrentBlocker = localStorage.getItem(CURRENT_BLOCKER_STORAGE_KEY);
        
        // If we have saved form data, use it
        if (savedFormData) {
          const parsedFormData = JSON.parse(savedFormData);
          // Only use saved data if it matches the current user
          if (parsedFormData.email_address === user.email) {
            setFormData(parsedFormData);
          } else {
            // If user is different, use user info but not saved form data
            setFormData(prev => ({
              ...prev,
              employee_name: user.name || '',
              email_address: user.email || '',
            }));
          }
        } else {
          // If no saved data, use user info
          setFormData(prev => ({
            ...prev,
            employee_name: user.name || '',
            email_address: user.email || '',
          }));
        }
        
        // Set team id if saved or from user profile
        if (savedSelectedTeam && savedFormData) {
          const parsedFormData = JSON.parse(savedFormData);
          if (parsedFormData.email_address === user.email) {
            setSelectedTeam(savedSelectedTeam);
          }
        } else if (user.teamId) {
          setSelectedTeam(user.teamId);
        }
        
        // Set blockers if saved
        if (savedBlockers && savedFormData) {
          const parsedFormData = JSON.parse(savedFormData);
          if (parsedFormData.email_address === user.email) {
            setBlockers(JSON.parse(savedBlockers));
          }
        }

        // Set current blocker if saved
        if (savedCurrentBlocker && savedFormData) {
          const parsedFormData = JSON.parse(savedFormData);
          if (parsedFormData.email_address === user.email) {
            setCurrentBlocker(JSON.parse(savedCurrentBlocker));
          }
        }
      } catch (error) {
        console.error('Error loading form data from localStorage:', error);
        // Fallback to default user data
        setFormData(prev => ({
          ...prev,
          employee_name: user.name || '',
          email_address: user.email || '',
        }));
        
        if (user.teamId) {
          setSelectedTeam(user.teamId);
        }
      }
    }
    
    fetchUserTeams();
    
    const date = new Date();
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    setCurrentDate(date.toLocaleDateString('en-US', options));
  }, [user]);

  // Save form data to localStorage immediately after each change
  useEffect(() => {
    if (formData.email_address && !isSubmitting) {
      debouncedSave(FORM_DATA_STORAGE_KEY, formData);
    }
  }, [formData, isSubmitting, debouncedSave]);

  // Save blockers to localStorage whenever they change
  useEffect(() => {
    if (formData.email_address && !isSubmitting) {
      debouncedSave(BLOCKERS_STORAGE_KEY, blockers);
    }
  }, [blockers, formData.email_address, isSubmitting, debouncedSave]);

  // Save current blocker to localStorage whenever it changes
  useEffect(() => {
    if (formData.email_address && !isSubmitting && showBlockerForm) {
      debouncedSave(CURRENT_BLOCKER_STORAGE_KEY, currentBlocker);
    }
  }, [currentBlocker, formData.email_address, isSubmitting, showBlockerForm, debouncedSave]);

  // Save selected team to localStorage whenever it changes
  useEffect(() => {
    if (selectedTeam && formData.email_address && !isSubmitting) {
      debouncedSave(SELECTED_TEAM_STORAGE_KEY, selectedTeam);
    }
  }, [selectedTeam, formData.email_address, isSubmitting, debouncedSave]);

  // Prevent unwanted refreshes when tab becomes visible again
  useEffect(() => {
    // Track router events to prevent unnecessary refreshes
    const handleRouteChangeStart = () => {
      // Store a flag to indicate intentional navigation
      sessionStorage.setItem('intentional_navigation', '1');
    };

    // Track initial load to avoid refresh on first render
    if (!initialLoadComplete.current) {
      initialLoadComplete.current = true;
      
      // Store tab state on initial load
      try {
        const timestamp = Date.now().toString();
        localStorage.setItem(TAB_STATE_PERSISTENCE_KEY, timestamp);
      } catch (error) {
        console.error('Error storing tab state:', error);
      }
    }

    router.events.on('routeChangeStart', handleRouteChangeStart);
    
    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart);
    };
  }, [router.events]);

  // Handle visibility change to ensure data is saved when tab is switched
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Tab is being hidden, save the form data
        if (formData.email_address) {
          saveAllFormData();
        }
        wasHidden.current = true;
      } else if (document.visibilityState === 'visible') {
        // Tab is becoming visible again
        tabFocusCount.current += 1;
        
        // Reset autosave status display
        if (autoSaveStatus === 'saving' || autoSaveStatus === 'saved') {
          setAutoSaveStatus('idle');
        }
        
        // If this wasn't triggered by a page navigation and the tab was previously hidden
        if (wasHidden.current && !sessionStorage.getItem('intentional_navigation')) {
          // Check if this is a legitimate tab switch rather than a refresh
          try {
            const lastTabState = localStorage.getItem(TAB_STATE_PERSISTENCE_KEY);
            
            if (lastTabState) {
              // Update the timestamp to indicate we handled this visibility change
              localStorage.setItem(TAB_STATE_PERSISTENCE_KEY, Date.now().toString());
              
              // Only prevent default behavior if we've already loaded the page once
              if (tabFocusCount.current > 1) {
                // Stop any events that might cause a refresh
                const event = window.event;
                if (event) {
                  // @ts-ignore - We know this is an event with preventDefault
                  if (typeof event.preventDefault === 'function') {
                    // @ts-ignore
                    event.preventDefault();
                  }
                  // @ts-ignore
                  if (typeof event.stopPropagation === 'function') {
                    // @ts-ignore
                    event.stopPropagation();
                  }
                }
              }
            }
          } catch (error) {
            console.error('Error handling tab visibility change:', error);
          }
        }
        
        // Clear intentional navigation flag if it exists
        sessionStorage.removeItem('intentional_navigation');
        wasHidden.current = false;
      }
    };
    
    // Save before page unload to catch navigation events
    const handleBeforeUnload = () => {
      if (formData.email_address) {
        saveAllFormData();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [formData, blockers, selectedTeam, currentBlocker, saveAllFormData, autoSaveStatus]);

  const fetchUserTeams = async () => {
    try {
      setLoadingTeams(true);
      
      // First try to get teams the user is a member of
      const { data: teamMemberships, error: membershipError } = await supabase
        .from('aditi_team_members')
        .select('team_id')
        .eq('employee_email', user?.email);

      if (membershipError) {
        console.error('Error fetching team memberships:', membershipError);
      }

      // If user has team memberships, get those teams
      if (teamMemberships && teamMemberships.length > 0) {
        const teamIds = teamMemberships.map(tm => tm.team_id);
        const { data: teamsData, error: teamsError } = await supabase
          .from('aditi_teams')
          .select('*')
          .in('id', teamIds);

        if (teamsError) {
          console.error('Error fetching specific teams:', teamsError);
          throw teamsError;
        }
        setTeams(teamsData || []);
      } else {
        // If no memberships found, fetch all teams
        const { data: allTeams, error: allTeamsError } = await supabase
          .from('aditi_teams')
          .select('*')
          .order('team_name', { ascending: true });

        if (allTeamsError) {
          console.error('Error fetching all teams:', allTeamsError);
          throw allTeamsError;
        }
        
        setTeams(allTeams || []);
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
    } finally {
      setLoadingTeams(false);
    }
  };

  const handleAddBlocker = () => {
    if (!currentBlocker.description || !currentBlocker.expected_resolution_date) {
      toast.error('Please fill in all blocker fields');
      return;
    }

    const newBlocker: Blocker = {
      id: Date.now().toString(),
      type: currentBlocker.type as 'Blockers' | 'Risks' | 'Dependencies',
      description: currentBlocker.description,
      expected_resolution_date: currentBlocker.expected_resolution_date
    };

    setBlockers([...blockers, newBlocker]);
    setCurrentBlocker({
      type: 'Blockers',
      description: '',
      expected_resolution_date: '',
    });
    setShowBlockerForm(false);
  };

  const handleRemoveBlocker = (id: string) => {
    setBlockers(blockers.filter(blocker => blocker.id !== id));
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    
    if (!formData.employee_name.trim()) {
      errors.employee_name = "Employee name is required";
    }
    
    if (!formData.employee_id.trim()) {
      errors.employee_id = "Employee ID is required";
    }
    
    if (!formData.email_address.trim()) {
      errors.email_address = "Email address is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email_address)) {
      errors.email_address = "Email address is invalid";
    }
    
    if (!selectedTeam) {
      errors.team = "Team selection is required";
    }
    
    if (!formData.tasks_completed.trim()) {
      errors.tasks_completed = "Tasks completed is required";
    }
    
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate form
    if (!validateForm()) {
      toast.error('Please fill all required fields correctly');
      return;
    }

    setIsSubmitting(true);
    try {
      // If there are no blockers, create a single update without blocker info
      if (blockers.length === 0) {
        const payload = {
          employee_name: formData.employee_name,
          employee_id: formData.employee_id,
          employee_email: formData.email_address,
          team_id: selectedTeam,
          tasks_completed: formData.tasks_completed,
          status: formData.status,
          additional_notes: formData.additional_notes
        };
        
        const { data, error } = await supabase
          .from('aditi_daily_updates')
          .insert([payload])
          .select();

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
      } else {
        // Insert each blocker as a separate daily update
        const updates = blockers.map(blocker => ({
          employee_name: formData.employee_name,
          employee_id: formData.employee_id,
          employee_email: formData.email_address,
          team_id: selectedTeam,
          tasks_completed: formData.tasks_completed,
          status: formData.status,
          additional_notes: formData.additional_notes,
          blocker_type: blocker.type,
          blocker_description: blocker.description,
          expected_resolution_date: blocker.expected_resolution_date,
        }));
        
        const { data, error } = await supabase
          .from('aditi_daily_updates')
          .insert(updates)
          .select();

        if (error) {
          throw new Error(`Database error: ${error.message}`);
        }
      }

      toast.success('Daily update submitted successfully!');
      setShowAnimation(true);
      
      // Clear localStorage after successful submission
      localStorage.removeItem(FORM_DATA_STORAGE_KEY);
      localStorage.removeItem(BLOCKERS_STORAGE_KEY);
      localStorage.removeItem(SELECTED_TEAM_STORAGE_KEY);
      
      setTimeout(() => {
        setShowAnimation(false);
        // Clear form
        setFormData({
          employee_name: user?.name || '',
          employee_id: formData.employee_id, // Keep the employee ID
          email_address: user?.email || '',
          tasks_completed: '',
          status: 'in-progress',
          additional_notes: '',
        });
        setBlockers([]);
        
        // Redirect to user dashboard
        router.push('/user-dashboard');
      }, 2000);
      
    } catch (error: any) {
      console.error('Error submitting daily update:', error);
      toast.error(error.message || 'Failed to submit daily update');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear validation error for this field when value changes
    if (formErrors[name]) {
      setFormErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  const handleBlockerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCurrentBlocker(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  // Also update team selection to clear errors
  const handleTeamChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedTeam(e.target.value);
    
    // Clear team validation error when value changes
    if (formErrors.team) {
      setFormErrors(prev => ({
        ...prev,
        team: ''
      }));
    }
  };

  // Extreme protection against page refreshes
  useEffect(() => {
    // Store page load timestamp to detect refreshes
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(FORM_LOADED_KEY, Date.now().toString());
      
      // Direct intervention at the form level
      if (!formStateInitialized.current) {
        formStateInitialized.current = true;
        
        // Force window to keep form state when tab becomes visible again
        const directPageStabilizer = (e: Event) => {
          if (document.visibilityState === 'visible') {
            // Cancel any pending navigation
            if (window.stop) window.stop();
            
            // Mark global state
            if (window.__ADITI_PREVENT_REFRESH !== undefined) {
              window.__ADITI_PREVENT_REFRESH = true;
            }
            
            // Force the tab to stabilize
            e.preventDefault?.();
            
            // Force state from storage to be restored
            const savedFormData = localStorage.getItem(FORM_DATA_STORAGE_KEY);
            const savedBlockers = localStorage.getItem(BLOCKERS_STORAGE_KEY);
            const savedSelectedTeam = localStorage.getItem(SELECTED_TEAM_STORAGE_KEY);
            
            if (savedFormData && !isSubmitting) {
              try {
                const parsedData = JSON.parse(savedFormData);
                if (parsedData && parsedData.email_address === user?.email) {
                  // Only update if the form isn't already showing this data
                  if (JSON.stringify(parsedData) !== JSON.stringify(formData)) {
                    setFormData(parsedData);
                  }
                  
                  if (savedSelectedTeam) {
                    setSelectedTeam(savedSelectedTeam);
                  }
                  
                  if (savedBlockers) {
                    try {
                      const parsedBlockers = JSON.parse(savedBlockers);
                      setBlockers(parsedBlockers);
                    } catch (error) {
                      console.error('Error parsing saved blockers:', error);
                    }
                  }
                }
              } catch (error) {
                console.error('Error processing saved form data:', error);
              }
            }
          }
        };
        
        // Use capture phase to intercept before other handlers
        document.addEventListener('visibilitychange', directPageStabilizer, true);
        
        return () => {
          document.removeEventListener('visibilitychange', directPageStabilizer, true);
        };
      }
    }
  }, [isSubmitting, formData, user]);

  return (
    <ProtectedRoute allowedRoles={['user', 'manager', 'admin']}>
      {/* Form-specific protection against refreshes */}
      <Script id="form-refresh-protection" strategy="afterInteractive">
        {`
          // Form-specific refresh protection
          (function() {
            // Add a flag to detect if we're returning to this form
            if (document.visibilityState === 'visible') {
              const lastFormTime = sessionStorage.getItem('${FORM_LOADED_KEY}');
              if (lastFormTime) {
                // We're coming back to the form, not performing an initial load
                console.log('Returning to form. Preventing refresh...');
                
                // Prevent refresh
                if (window.stop) window.stop();
                
                // Restore saved form data
                try {
                  const savedFormData = localStorage.getItem('${FORM_DATA_STORAGE_KEY}');
                  if (savedFormData) {
                    // Signal to the React component to restore data
                    window.dispatchEvent(new CustomEvent('form:restore', { 
                      detail: { time: Date.now() } 
                    }));
                  }
                } catch (e) {
                  console.error('Error in form protection script:', e);
                }
              }
            }
          })();
        `}
      </Script>
      
      <div className="min-h-screen bg-[#1a1f2e] text-white">
        <Head>
          <title>Daily Update | Aditi Task Management</title>
          <meta name="description" content="Submit your daily work progress and updates" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>

        <main className="py-4 sm:py-8 md:py-12">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-[#1e2538] shadow-xl rounded-lg overflow-hidden">
              <div className="bg-gradient-to-r from-purple-600 to-indigo-700 text-white py-6 px-6 md:px-8">
                <div className="flex justify-between items-center">
                  <h1 className="text-xl md:text-2xl font-bold mb-2">Daily Update Form</h1>
                  {/* Auto Save Indicator */}
                  {autoSaveStatus !== 'idle' && (
                    <div className="flex items-center text-sm">
                      {autoSaveStatus === 'saving' && (
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      )}
                      {autoSaveStatus === 'saved' && (
                        <svg className="mr-2 h-4 w-4 text-green-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {autoSaveStatus === 'error' && (
                        <svg className="mr-2 h-4 w-4 text-red-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span>
                        {autoSaveStatus === 'saving' && 'Auto-saving...'}
                        {autoSaveStatus === 'saved' && 'Changes saved'}
                        {autoSaveStatus === 'error' && 'Error saving'}
                      </span>
                    </div>
                  )}
                </div>
                <p className="text-purple-100">{currentDate}</p>
              </div>

              <form onSubmit={handleSubmit} className="p-6 md:p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Employee Name */}
                  <div>
                    <label htmlFor="employee_name" className="block text-sm font-medium text-gray-200 mb-1">
                      Employee Name*
                    </label>
                    <input
                      type="text"
                      id="employee_name"
                      name="employee_name"
                      value={formData.employee_name}
                      onChange={handleChange}
                      className={`shadow-sm block w-full sm:text-sm rounded-md border bg-[#262d40] text-white ${
                        formErrors.employee_name ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                      } p-2`}
                      placeholder="Your full name"
                    />
                    {formErrors.employee_name && (
                      <p className="mt-1 text-sm text-red-400">{formErrors.employee_name}</p>
                    )}
                  </div>

                  {/* Employee ID */}
                  <div>
                    <label htmlFor="employee_id" className="block text-sm font-medium text-gray-200 mb-1">
                      Employee ID*
                    </label>
                    <input
                      type="text"
                      id="employee_id"
                      name="employee_id"
                      value={formData.employee_id}
                      onChange={handleChange}
                      className={`shadow-sm block w-full sm:text-sm rounded-md border bg-[#262d40] text-white ${
                        formErrors.employee_id ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                      } p-2`}
                      placeholder="Your employee ID"
                    />
                    {formErrors.employee_id && (
                      <p className="mt-1 text-sm text-red-400">{formErrors.employee_id}</p>
                    )}
                  </div>

                  {/* Email Address */}
                  <div>
                    <label htmlFor="email_address" className="block text-sm font-medium text-gray-200 mb-1">
                      Email Address*
                    </label>
                    <input
                      type="email"
                      id="email_address"
                      name="email_address"
                      value={formData.email_address}
                      onChange={handleChange}
                      className={`shadow-sm block w-full sm:text-sm rounded-md border bg-[#262d40] text-white ${
                        formErrors.email_address ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                      } p-2`}
                      placeholder="Your email address"
                      disabled={!!user}
                    />
                    {formErrors.email_address && (
                      <p className="mt-1 text-sm text-red-400">{formErrors.email_address}</p>
                    )}
                  </div>

                  {/* Team Selection */}
                  <div>
                    <label htmlFor="team" className="block text-sm font-medium text-gray-200 mb-1">
                      Team*
                    </label>
                    <select
                      id="team"
                      name="team"
                      value={selectedTeam}
                      onChange={handleTeamChange}
                      className={`shadow-sm block w-full sm:text-sm rounded-md border bg-[#262d40] text-white ${
                        formErrors.team ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                      } p-2`}
                      disabled={loadingTeams}
                    >
                      <option value="" disabled>Select your team</option>
                      {teams.map(team => (
                        <option key={team.id} value={team.id}>
                          {team.team_name}
                        </option>
                      ))}
                    </select>
                    {formErrors.team && (
                      <p className="mt-1 text-sm text-red-400">{formErrors.team}</p>
                    )}
                  </div>
                </div>

                {/* Tasks Completed */}
                <div className="mt-6">
                  <label htmlFor="tasks_completed" className="block text-sm font-medium text-gray-200 mb-1">
                    Tasks Completed Today*
                  </label>
                  <textarea
                    id="tasks_completed"
                    name="tasks_completed"
                    rows={4}
                    value={formData.tasks_completed}
                    onChange={handleChange}
                    className={`shadow-sm block w-full sm:text-sm rounded-md border bg-[#262d40] text-white ${
                      formErrors.tasks_completed ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-600 focus:ring-purple-500 focus:border-purple-500'
                    } p-2`}
                    placeholder="List the tasks you completed today"
                  />
                  {formErrors.tasks_completed && (
                    <p className="mt-1 text-sm text-red-400">{formErrors.tasks_completed}</p>
                  )}
                </div>

                {/* Status */}
                <div className="mt-6">
                  <label htmlFor="status" className="block text-sm font-medium text-gray-200 mb-1">
                    Status
                  </label>
                  <select
                    id="status"
                    name="status"
                    value={formData.status}
                    onChange={handleChange}
                    className="shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 bg-[#262d40] text-white rounded-md p-2"
                  >
                    <option value="in-progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="blocked">Blocked</option>
                  </select>
                </div>

                {/* Additional Notes */}
                <div className="mt-6">
                  <label htmlFor="additional_notes" className="block text-sm font-medium text-gray-200 mb-1">
                    Additional Notes
                  </label>
                  <textarea
                    id="additional_notes"
                    name="additional_notes"
                    rows={3}
                    value={formData.additional_notes}
                    onChange={handleChange}
                    className="shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 bg-[#262d40] text-white rounded-md p-2"
                    placeholder="Any additional comments or notes"
                  />
                </div>

                {/* Blockers Section */}
                <div className="mt-8 border-t border-gray-700 pt-6">
                  <h3 className="text-lg font-medium text-white mb-4">Blockers, Risks, or Dependencies</h3>
                  
                  {/* List of added blockers */}
                  {blockers.length > 0 && (
                    <div className="mb-4 space-y-3">
                      {blockers.map(blocker => (
                        <div key={blocker.id} className="bg-[#262d40] p-3 rounded-md flex justify-between items-start">
                          <div>
                            <div className="flex items-center mb-1">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                blocker.type === 'Blockers' ? 'bg-red-900 text-red-200' :
                                blocker.type === 'Risks' ? 'bg-yellow-900 text-yellow-200' :
                                'bg-blue-900 text-blue-200'
                              }`}>
                                {blocker.type}
                              </span>
                              <span className="ml-2 text-sm text-gray-300">
                                (Expected resolution: {blocker.expected_resolution_date})
                              </span>
                            </div>
                            <p className="text-sm text-gray-200">{blocker.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveBlocker(blocker.id)}
                            className="text-red-400 hover:text-red-300 ml-2"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add blocker button or form */}
                  {showBlockerForm ? (
                    <div className="bg-[#262d40] p-4 rounded-md">
                      <h4 className="text-md font-medium text-gray-100 mb-3">Add Blocker/Risk/Dependency</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                          <label htmlFor="type" className="block text-sm font-medium text-gray-200 mb-1">
                            Type
                          </label>
                          <select
                            id="type"
                            name="type"
                            value={currentBlocker.type}
                            onChange={handleBlockerChange}
                            className="shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 bg-[#2a3349] text-white rounded-md"
                          >
                            <option value="Blockers">Blocker</option>
                            <option value="Risks">Risk</option>
                            <option value="Dependencies">Dependency</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="expected_resolution_date" className="block text-sm font-medium text-gray-200 mb-1">
                            Expected Resolution Date
                          </label>
                          <input
                            type="date"
                            id="expected_resolution_date"
                            name="expected_resolution_date"
                            value={currentBlocker.expected_resolution_date}
                            onChange={handleBlockerChange}
                            className="shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 bg-[#2a3349] text-white rounded-md"
                          />
                        </div>
                      </div>
                      <div className="mb-4">
                        <label htmlFor="description" className="block text-sm font-medium text-gray-200 mb-1">
                          Description
                        </label>
                        <textarea
                          id="description"
                          name="description"
                          rows={3}
                          value={currentBlocker.description}
                          onChange={handleBlockerChange}
                          className="shadow-sm focus:ring-purple-500 focus:border-purple-500 block w-full sm:text-sm border-gray-600 bg-[#2a3349] text-white rounded-md"
                          placeholder="Describe the blocker, risk, or dependency"
                        />
                      </div>
                      <div className="flex justify-end space-x-3">
                        <button
                          type="button"
                          className="px-4 py-2 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-200 bg-[#2a3349] hover:bg-[#313a58] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                          onClick={() => setShowBlockerForm(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                          onClick={handleAddBlocker}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowBlockerForm(true)}
                      className="inline-flex items-center px-4 py-2 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-200 bg-[#262d40] hover:bg-[#2a3349] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="-ml-1 mr-2 h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Add Blocker/Risk/Dependency
                    </button>
                  )}
                </div>

                {/* Form Actions */}
                <div className="mt-8 pt-5 border-t border-gray-700 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => router.push('/user-dashboard')}
                    className="px-4 py-2 border border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-200 bg-[#262d40] hover:bg-[#2a3349] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className={`inline-flex items-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-white ${
                      isSubmitting ? 'bg-purple-500 opacity-70 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500'
                    }`}
                  >
                    {isSubmitting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Submitting...
                      </>
                    ) : (
                      'Submit Daily Update'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </main>

        {/* Success animation overlay */}
        {showAnimation && (
          <div className="fixed inset-0 flex items-center justify-center bg-gray-900 bg-opacity-75 z-50">
            <div className="text-center p-8 bg-[#1e2538] rounded-lg shadow-xl">
              <div className="w-24 h-24 rounded-full bg-purple-900 flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Update Submitted!</h2>
              <p className="text-gray-300">Your daily update has been submitted successfully.</p>
            </div>
          </div>
        )}
      </div>
    </ProtectedRoute>
  );
} 