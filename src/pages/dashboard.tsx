import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase, DailyUpdate, TeamMember } from '../lib/supabaseClient';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { useAuth } from '../lib/authContext';
import ProtectedRoute from '../components/ProtectedRoute';

interface DashboardUser {
  userName: string;
  userEmail: string;
  teamName: string;
  isManager: boolean;
}

export default function Dashboard() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFailed, setLoadingFailed] = useState(false);
  const [historicalData, setHistoricalData] = useState<DailyUpdate[]>([]);
  const [filteredData, setFilteredData] = useState<DailyUpdate[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'blockers'>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [teams, setTeams] = useState<TeamMember[]>([]);
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 7)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  });
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [stats, setStats] = useState({
    totalUpdates: 0,
    totalBlockers: 0,
    completedTasks: 0,
    inProgressTasks: 0,
    stuckTasks: 0
  });

  // Additional state for data loading and pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [loadingTimeout, setLoadingTimeout] = useState<NodeJS.Timeout | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    // Safety timeout to prevent infinite loading
    const safetyTimeout = setTimeout(() => {
      if (isLoading) {
        console.log('Dashboard safety timeout reached');
        setIsLoading(false);
        setLoadingFailed(true);
      }
    }, 10000);
    
    if (user) {
      fetchTeamsBasedOnRole();
    }
    
    return () => clearTimeout(safetyTimeout);
  }, [user]);

  const fetchTeamsBasedOnRole = async () => {
    if (!user) return;
    
    try {
      setIsLoading(true);
      // Admin can see all teams
      if (user.role === 'admin') {
        const { data, error } = await supabase
          .from('aditi_teams')
          .select('*')
          .order('team_name', { ascending: true });
          
        if (error) throw error;
        setTeams(data || []);
        await fetchData(''); // Begin data fetch immediately after teams are loaded
      } 
      // Manager can only see their teams
      else if (user.role === 'manager') {
        const { data, error } = await supabase
          .from('aditi_teams')
          .select('*')
          .eq('manager_email', user.email)
          .order('team_name', { ascending: true });
          
        if (error) throw error;
        setTeams(data || []);
        
        // If manager has exactly one team, auto-select it
        if (data && data.length === 1) {
          setSelectedTeam(data[0].id);
          await fetchData(data[0].id); // Begin data fetch with the selected team
        } else {
          await fetchData(''); // Fetch all teams' data if multiple teams
        }
      }
      // Regular users shouldn't reach this dashboard, but just in case
      else {
        // If it's a regular user who somehow accessed this page, 
        // redirect them to the user dashboard
        router.replace('/user-dashboard');
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
      toast.error('Failed to load teams');
      setIsLoading(false);
      setLoadingFailed(true);
    }
  };

  const fetchData = async (teamFilter: string = '') => {
    try {
      setIsLoading(true);
      
      // Set a hard timeout to prevent the loader from getting stuck forever
      const timeout = setTimeout(() => {
        setIsLoading(false);
        console.log('Fetch data timeout reached, forcing loading state to false');
      }, 8000); // 8 seconds max loading time
      
      if (loadingTimeout) clearTimeout(loadingTimeout);
      setLoadingTimeout(timeout);
      
      let query = supabase
        .from('aditi_daily_updates')
        .select('*, aditi_teams(*)');

      // Admin with no team filter sees all data
      if (user?.role === 'admin' && !teamFilter) {
        // No additional filters needed - admin sees all
      } 
      // Admin with team filter or manager sees specific team data
      else if (teamFilter) {
        query = query.eq('team_id', teamFilter);
      }
      // Manager with no specific team selected sees all their teams' data
      else if (user?.role === 'manager') {
        const managerTeamIds = teams.map(team => team.id);
        if (managerTeamIds.length > 0) {
          query = query.in('team_id', managerTeamIds);
        } else {
          // If no teams found for manager, show empty result
          setHistoricalData([]);
          setFilteredData([]);
          calculateStats([]);
          setIsLoading(false);
          if (loadingTimeout) clearTimeout(loadingTimeout);
          return;
        }
      }

      query = query.order('created_at', { ascending: false });
      
      const { data, error } = await query;

      if (error) {
        // Handle error cases
        throw error;
      }
      
      setHistoricalData(data || []);
      setFilteredData(data || []);
      calculateStats(data || []);
      setLastRefreshed(new Date());
      setDataLoaded(true);
    } catch (error) {
      console.error('Error fetching data:', error);
      
      // Check for 406 error (Not Acceptable)
      if (error && (
        (error as any).code === '406' || 
        (error as any).message?.includes('406') || 
        (error as any).status === 406
      )) {
        console.error('Session token issue detected (406 error). Attempting to refresh session...');
        
        try {
          // Try to refresh the session
          const { data: sessionData, error: refreshError } = await supabase.auth.refreshSession();
          
          if (refreshError || !sessionData.session) {
            console.error('Failed to refresh session after 406 error:', refreshError);
            
            // Clear any cached authentication data and sign out
            try {
              await signOut();
              return;
            } catch (e) {
              console.error('Error during sign out after 406 error:', e);
              // Force redirect to login page if sign out fails
              window.location.href = '/';
              return;
            }
          }
          
          // Retry the fetch after successful token refresh
          console.log('Session refreshed, retrying data fetch...');
          
          // Rebuild the query
          let retryQuery = supabase
            .from('aditi_daily_updates')
            .select('*, aditi_teams(*)');
            
          if (user?.role === 'admin' && !teamFilter) {
            // No additional filters needed - admin sees all
          } 
          else if (teamFilter) {
            retryQuery = retryQuery.eq('team_id', teamFilter);
          }
          else if (user?.role === 'manager') {
            const managerTeamIds = teams.map(team => team.id);
            if (managerTeamIds.length > 0) {
              retryQuery = retryQuery.in('team_id', managerTeamIds);
            }
          }
          
          retryQuery = retryQuery.order('created_at', { ascending: false });
          
          const { data: retryData, error: retryError } = await retryQuery;
            
          if (retryError) {
            throw retryError;
          }
          
          setHistoricalData(retryData || []);
          setFilteredData(retryData || []);
          calculateStats(retryData || []);
          setLastRefreshed(new Date());
          setDataLoaded(true);
        } catch (retryError) {
          console.error('Error during retry:', retryError);
          toast.error('Failed to load updates');
          setHistoricalData([]);
          setFilteredData([]);
          calculateStats([]);
          setLoadingFailed(true);
        }
      } else {
        toast.error('Failed to load updates');
        setHistoricalData([]);
        setFilteredData([]);
        calculateStats([]);
        setLoadingFailed(true);
      }
    } finally {
      setIsLoading(false);
      if (loadingTimeout) clearTimeout(loadingTimeout);
    }
  };

  const calculateStats = (data: DailyUpdate[]) => {
    const stats = {
      totalUpdates: data.length,
      totalBlockers: data.filter(update => update.blocker_type).length,
      completedTasks: data.filter(update => update.status === 'completed').length,
      inProgressTasks: data.filter(update => update.status === 'in-progress').length,
      stuckTasks: data.filter(update => update.status === 'blocked').length
    };
    setStats(stats);
  };

  const applyFilters = () => {
    let filtered = [...historicalData];

    // Apply date range filter
    filtered = filtered.filter(update => {
      const updateDate = new Date(update.created_at).toISOString().split('T')[0];
      return updateDate >= dateRange.start && updateDate <= dateRange.end;
    });

    // Apply team filter
    if (selectedTeam) {
      filtered = filtered.filter(update => update.team_id === selectedTeam);
    }

    // Apply tab filter
    switch (activeTab) {
      case 'recent':
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        filtered = filtered.filter(update => 
          new Date(update.created_at) >= sevenDaysAgo
        );
        break;
      case 'blockers':
        filtered = filtered.filter(update => update.blocker_type);
        break;
    }

    setFilteredData(filtered);
    calculateStats(filtered);
  };

  useEffect(() => {
    if (user) {
      fetchData(selectedTeam);
    }
  }, [selectedTeam, user]);

  useEffect(() => {
    applyFilters();
  }, [activeTab, selectedTeam, dateRange, historicalData]);

  const toggleRowExpansion = (id: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const exportToCSV = () => {
    const headers = [
      'Date',
      'Team',
      'Employee',
      'Tasks Completed',
      'Status',
      'Blockers/Risks/Dependencies',
      'Expected Resolution',
      'Additional Notes'
    ];

    const csvContent = [
      headers.join(','),
      ...filteredData.map(update => [
        new Date(update.created_at).toLocaleDateString(),
        update.aditi_teams?.team_name || team_name_from_teams(update) || '',
        update.employee_email,
        update.tasks_completed,
        update.status,
        update.blocker_type || '',
        update.expected_resolution_date || '',
        update.additional_notes || ''
      ].join(','))
    ].join('\n');

    // Helper function to get team name from teams array if aditi_teams is not present
    function team_name_from_teams(update: DailyUpdate) {
      if (update.team_id) {
        const team = teams.find(t => t.id === update.team_id);
        return team?.team_name || '';
      }
      return '';
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `daily-updates-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      await fetchData(selectedTeam);
      setLastRefreshed(new Date());
      toast.success('Data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast.error('Failed to refresh data');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <ProtectedRoute allowedRoles={['admin', 'manager']}>
      <Head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Dashboard | Aditi Daily Updates</title>
        <meta name="description" content="Manager dashboard for Aditi daily updates tracking" />
      </Head>
      
      <div className="min-h-screen bg-gray-100">
        <div className="fixed top-4 right-4 z-10">
          <button 
            onClick={() => signOut()}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 shadow-md hover:shadow-lg flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
        
        <div className="bg-indigo-900 text-white">
          <div className="max-w-7xl mx-auto py-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between">
              <div className="flex-1 flex items-center">
                <span className="flex p-2 rounded-lg bg-indigo-800">
                  <svg className="h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </span>
                <p className="ml-3 font-medium truncate">
                  <span className="md:hidden">
                    {user?.role === 'admin' ? 'Admin Dashboard' : 'Manager Dashboard'}
                  </span>
                  <span className="hidden md:inline">
                    {user?.role === 'admin' 
                      ? 'Admin Dashboard - Full Access' 
                      : `Manager Dashboard - ${user?.name} (${user?.email})`}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="min-h-screen bg-[#1a1f2e] text-white flex flex-col">
          <nav className="bg-[#1e2538] shadow-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-16">
                <div className="flex items-center">
                  <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">
                    Aditi Manager Dashboard
                  </h1>
                </div>
                <div className="flex items-center">
                  <span className="mr-4 text-sm text-gray-300">
                    {/* {user ? `Welcome, ${user.user_metadata.name}` : 'Loading...'} */}
                    {user ? `Welcome, }` : 'Loading...'}
                  </span>
                  <button
                    onClick={() => router.push('/')}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-md text-sm transition-colors duration-300"
                  >
                    Daily Update Form
                  </button>
                </div>
              </div>
            </div>
          </nav>
          
          <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            {isLoading ? (
              <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
              </div>
            ) : loadingFailed ? (
              <div className="bg-[#1e2538] rounded-lg shadow-lg p-6 text-center">
                <h2 className="text-xl font-semibold text-red-400 mb-4">There was an issue loading the dashboard</h2>
                <p className="mb-4">We encountered an error while loading your data. Please try again.</p>
                <div className="flex justify-center space-x-4">
                  <button 
                    onClick={() => {
                      setLoadingFailed(false);
                      fetchTeamsBasedOnRole();
                    }}
                    className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
                  >
                    Retry
                  </button>
                  <button 
                    onClick={() => router.reload()}
                    className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
                  >
                    Reload Page
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                  <div className="bg-[#262d40] p-4 rounded-lg shadow-lg hover:shadow-custom-purple transition-shadow duration-300">
                    <h3 className="text-gray-400 text-sm">Total Updates</h3>
                    <p className="text-2xl font-bold text-white">{stats.totalUpdates}</p>
                  </div>
                  <div className="bg-[#262d40] p-4 rounded-lg shadow-lg hover:shadow-custom-purple transition-shadow duration-300">
                    <h3 className="text-gray-400 text-sm">Issues/Blockers</h3>
                    <p className="text-2xl font-bold text-white">{stats.totalBlockers}</p>
                  </div>
                  <div className="bg-[#262d40] p-4 rounded-lg shadow-lg hover:shadow-custom-purple transition-shadow duration-300">
                    <h3 className="text-gray-400 text-sm">Completed Tasks</h3>
                    <p className="text-2xl font-bold text-green-400">{stats.completedTasks}</p>
                  </div>
                  <div className="bg-[#262d40] p-4 rounded-lg shadow-lg hover:shadow-custom-purple transition-shadow duration-300">
                    <h3 className="text-gray-400 text-sm">In Progress</h3>
                    <p className="text-2xl font-bold text-blue-400">{stats.inProgressTasks}</p>
                  </div>
                  <div className="bg-[#262d40] p-4 rounded-lg shadow-lg hover:shadow-custom-purple transition-shadow duration-300">
                    <h3 className="text-gray-400 text-sm">Stuck</h3>
                    <p className="text-2xl font-bold text-red-400">{stats.stuckTasks}</p>
                  </div>
                </div>
                
                <div className="bg-[#1e2538] rounded-lg shadow-lg p-4 mb-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4 md:mb-0">
                      <div>
                        <label htmlFor="team-filter" className="block text-sm text-gray-400 mb-1">Team</label>
                        <select
                          id="team-filter"
                          value={selectedTeam}
                          onChange={(e) => setSelectedTeam(e.target.value)}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="">All Teams</option>
                          {teams.map((team, index) => (
                            <option key={index} value={team.id}>{team.team_name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="date-start" className="block text-sm text-gray-400 mb-1">Start Date</label>
                        <input
                          type="date"
                          id="date-start"
                          value={dateRange.start}
                          onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="date-end" className="block text-sm text-gray-400 mb-1">End Date</label>
                        <input
                          type="date"
                          id="date-end"
                          value={dateRange.end}
                          onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                          className="bg-[#262d40] border border-gray-600 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <button
                        onClick={refreshData}
                        disabled={isRefreshing}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isRefreshing ? (
                          <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Refreshing...
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Refresh Data
                          </>
                        )}
                      </button>
                      <button
                        onClick={exportToCSV}
                        disabled={!filteredData.length || isRefreshing}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>
                  {lastRefreshed && (
                    <div className="mt-3 text-xs text-gray-400 text-right">
                      Last updated: {lastRefreshed.toLocaleString()}
                    </div>
                  )}
                </div>
                
                <div className="mb-6">
                  <div className="border-b border-gray-700">
                    <nav className="flex -mb-px">
                      <button
                        onClick={() => setActiveTab('all')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'all'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        All Updates
                      </button>
                      <button
                        onClick={() => setActiveTab('recent')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'recent'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Recent (5 Days)
                      </button>
                      <button
                        onClick={() => setActiveTab('blockers')}
                        className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors duration-300 ${
                          activeTab === 'blockers'
                            ? 'border-purple-500 text-purple-400'
                            : 'border-transparent text-gray-400 hover:text-gray-300 hover:border-gray-400'
                        }`}
                      >
                        Blockers Only
                      </button>
                    </nav>
                  </div>
                </div>
                
                {filteredData.length > 0 ? (
                  <div className="bg-[#1e2538] rounded-lg shadow-lg overflow-hidden">
                    <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                      <div className="inline-block min-w-full align-middle">
                        <div className="overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-700 table-fixed">
                            <thead className="bg-[#262d40]">
                              <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[120px]">
                                  Date
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[150px]">
                                  Team
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[200px]">
                                  Employee
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[300px]">
                                  Tasks Completed
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[120px]">
                                  Status
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[150px]">
                                  Blockers
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[150px]">
                                  Expected Resolution
                                </th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider w-[200px]">
                                  Additional Notes
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                              {filteredData.map((item, index) => {
                                const rowId = `row-${index}`;
                                const isExpanded = expandedRows[rowId] || false;
                                const team = teams.find(t => t.id === item.team_id);

                                return (
                                  <React.Fragment key={rowId}>
                                    <tr 
                                      className="hover:bg-[#2a3347] transition-colors duration-200 cursor-pointer"
                                      onClick={() => toggleRowExpansion(rowId)}
                                    >
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {new Date(item.created_at).toLocaleDateString()}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {team?.team_name || '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="text-sm text-gray-300">{item.employee_email}</span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        <span className="text-gray-300">{item.tasks_completed}</span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                          item.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                                          item.status === 'in-progress' ? 'bg-blue-500/20 text-blue-400' :
                                          'bg-red-500/20 text-red-400'
                                        }`}>
                                          {item.status}
                                        </span>
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        {item.blocker_type ? (
                                          <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded-full text-xs">
                                            {item.blocker_type}
                                          </span>
                                        ) : (
                                          <span className="text-gray-400">-</span>
                                        )}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.expected_resolution_date ? new Date(item.expected_resolution_date).toLocaleDateString() : '-'}
                                      </td>
                                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                        {item.additional_notes || '-'}
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr>
                                        <td colSpan={8} className="px-6 py-4 bg-[#1e2538]">
                                          <div className="space-y-4">
                                            <div>
                                              <h4 className="text-sm font-medium text-gray-300 mb-2">Tasks Completed</h4>
                                              <p className="text-sm text-white whitespace-pre-wrap">{item.tasks_completed}</p>
                                            </div>
                                            
                                            {item.blocker_type && (
                                              <>
                                                <h4 className="text-sm font-medium text-gray-300 mb-2">Blockers / Risks / Dependencies</h4>
                                                <div className="space-y-2">
                                                  <div className="bg-[#1e2538] p-3 rounded-md">
                                                    <div className="flex items-center space-x-2 mb-1">
                                                      <span className={`inline-block px-2 py-1 text-xs rounded-full ${
                                                        item.blocker_type === 'Risks' ? 'bg-yellow-500/20 text-yellow-400' :
                                                        item.blocker_type === 'Blockers' ? 'bg-red-500/20 text-red-400' :
                                                        'bg-blue-500/20 text-blue-400'
                                                      }`}>
                                                        {item.blocker_type}
                                                      </span>
                                                      <span className="text-xs text-gray-400">
                                                        Resolution: {item.expected_resolution_date ? new Date(item.expected_resolution_date).toLocaleDateString() : 'Not set'}
                                                      </span>
                                                    </div>
                                                    <p className="text-sm text-white whitespace-pre-wrap">{item.blocker_description}</p>
                                                  </div>
                                                </div>
                                              </>
                                            )}

                                            {item.additional_notes && (
                                              <>
                                                <h4 className="text-sm font-medium text-gray-300 mb-2">Additional Notes</h4>
                                                <p className="text-sm text-white whitespace-pre-wrap">{item.additional_notes}</p>
                                              </>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#1e2538] rounded-lg shadow-lg p-8 text-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 14h.01M12 17h.01M12 20a8 8 0 100-16 8 8 0 000 16z" />
                    </svg>
                    <h3 className="text-lg font-medium text-gray-300 mb-1">No data found</h3>
                    <p className="text-gray-400">
                      {activeTab === 'blockers' 
                        ? 'No blockers reported for the selected filters.' 
                        : 'No updates available for the selected filters.'}
                    </p>
                  </div>
                )}
                
                {filteredData.length > 0 && totalPages > 1 && (
                  <div className="flex justify-between items-center mt-6 bg-[#1e2538] rounded-lg p-3">
                    <div className="text-sm text-gray-400">
                      Showing {filteredData.length} of {historicalData.length} entries
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 bg-[#262d40] text-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2a3347] transition-colors duration-200"
                      >
                        Previous
                      </button>
                      <div className="flex items-center space-x-1">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          
                          return (
                            <button
                              key={i}
                              onClick={() => setCurrentPage(pageNum)}
                              className={`w-8 h-8 flex items-center justify-center rounded-md text-sm
                                ${pageNum === currentPage 
                                  ? 'bg-purple-600 text-white' 
                                  : 'bg-[#262d40] text-gray-300 hover:bg-[#2a3347]'} 
                                transition-colors duration-200`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 bg-[#262d40] text-gray-300 rounded-md text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2a3347] transition-colors duration-200"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
          
          <footer className="bg-[#1e2538] py-3 mt-auto">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <p className="text-center text-gray-400 text-sm">
                © {new Date().getFullYear()} Aditi Updates. All rights reserved.
              </p>
            </div>
          </footer>
        </div>
      </div>
    </ProtectedRoute>
  );
} 