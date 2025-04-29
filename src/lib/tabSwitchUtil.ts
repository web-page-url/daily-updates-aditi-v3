/**
 * Tab Switch Prevention Utility
 * 
 * This utility helps prevent unwanted page refreshes when users switch tabs
 * by providing helper functions to detect tab visibility changes and control
 * behavior when returning to the tab.
 */

/**
 * Checks if the current view state is due to returning from a tab switch
 */
export const isReturningFromTabSwitch = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  return !!(
    sessionStorage.getItem('returning_from_tab_switch') || 
    sessionStorage.getItem('prevent_auto_refresh') ||
    document.body.classList.contains('tab-just-activated') ||
    document.body.classList.contains('dashboard-tab-active')
  );
};

/**
 * Sets flags to prevent refresh on the next tab switch return
 */
export const preventNextTabSwitchRefresh = (): void => {
  if (typeof window === 'undefined') return;
  
  sessionStorage.setItem('prevent_auto_refresh', Date.now().toString());
  
  // Clear the flag after some time
  setTimeout(() => {
    sessionStorage.removeItem('prevent_auto_refresh');
  }, 5000);
};

/**
 * Applies the prevention mechanism specifically for fetch/XHR requests
 * Can be used with a custom fetch wrapper
 */
export const applySwitchPreventionToFetch = (): void => {
  if (typeof window === 'undefined') return;
  
  // Store original fetch
  const originalFetch = window.fetch;
  
  // Override fetch
  window.fetch = function(...args) {
    // If we're returning from a tab switch, block non-critical requests
    if (isReturningFromTabSwitch()) {
      const url = args[0].toString();
      
      // Block automatic auth/session requests
      if (url.includes('/auth/') || url.includes('/session')) {
        console.log('Blocking automatic fetch due to tab switch', url);
        
        // Return a fake successful response
        return Promise.resolve(new Response(JSON.stringify({
          success: true,
          data: null,
        }), { status: 200 }));
      }
    }
    
    // Otherwise proceed with original fetch
    return originalFetch.apply(this, args);
  };
}; 