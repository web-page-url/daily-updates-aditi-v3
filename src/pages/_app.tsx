import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { AuthProvider } from "@/lib/authContext";
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { initializeFormPersistence } from '@/lib/formPersistenceStore';
import Script from 'next/script';

// Global variable to track if the app has been initialized
declare global {
  interface Window {
    __ADITI_APP_INITIALIZED: boolean;
    __ADITI_CURRENT_USER: any;
    __ADITI_PREVENT_REFRESH: boolean;
  }
}

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isAdminRoute, setIsAdminRoute] = useState(false);
  const [pageTabRefreshPrevented, setPageTabRefreshPrevented] = useState(false);
  const initialRender = useRef(true);
  const [forceRerender, setForceRerender] = useState(0);

  // Initialize form persistence store with enhanced tab switch handling
  useEffect(() => {
    // Only run in browser and only once
    if (typeof window !== 'undefined' && initialRender.current) {
      initialRender.current = false;

      // Set global initialization flag
      window.__ADITI_APP_INITIALIZED = true;
      window.__ADITI_PREVENT_REFRESH = false;

      // Initialize form persistence
      initializeFormPersistence();
      
      // Disable page refreshes on tab switching completely for critical form pages
      const preventRefreshOnFormPages = () => {
        const isFormPage = 
          router.pathname.includes('daily-update-form') || 
          router.pathname.includes('edit-profile') ||
          router.pathname.includes('dashboard');
          
        if (isFormPage) {
          window.__ADITI_PREVENT_REFRESH = true;
          setPageTabRefreshPrevented(true);
          
          // Force a rerender after visibility change to ensure components update properly
          if (document.visibilityState === 'visible') {
            setTimeout(() => {
              setForceRerender(prev => prev + 1);
            }, 100);
          }
        } else {
          window.__ADITI_PREVENT_REFRESH = false;
        }
      };

      // Apply the prevention on initial load
      preventRefreshOnFormPages();
      
      // Update prevention on route changes
      router.events.on('routeChangeComplete', preventRefreshOnFormPages);
      
      // Direct intervention to prevent refreshing
      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible' && window.__ADITI_PREVENT_REFRESH) {
          // Cancel any pending refreshes
          if (window.stop) {
            window.stop();
          }
          
          // Force a state update to ensure components update
          setTimeout(() => {
            setForceRerender(prev => prev + 1);
          }, 100);
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        router.events.off('routeChangeComplete', preventRefreshOnFormPages);
      };
    }
  }, [router]);

  // Route-specific handling
  useEffect(() => {
    // Check if current route is an admin/manager route
    const adminRouteCheck = () => {
      const isAdmin = router.pathname === '/dashboard' || 
                      router.pathname.includes('/team-management') || 
                      router.pathname.includes('/admin');
      setIsAdminRoute(isAdmin);
    };
    
    adminRouteCheck();
    router.events.on('routeChangeComplete', adminRouteCheck);
    
    return () => {
      router.events.off('routeChangeComplete', adminRouteCheck);
    };
  }, [router.pathname, router.events]);

  // Global loading state timeout handler
  useEffect(() => {
    // This adds a safety mechanism for all pages to prevent hanging loading states
    const html = document.documentElement;
    html.classList.add('js-loading');
    
    // Force remove loading class after timeout
    // Use shorter timeout for admin routes since they have their own handling
    const timeoutDuration = isAdminRoute ? 5000 : 8000;
    
    const globalTimeout = setTimeout(() => {
      html.classList.remove('js-loading');
      console.log(`Global loading safety timeout reached (${isAdminRoute ? 'admin route' : 'standard route'})`);
    }, timeoutDuration);
    
    // Listen for route change end
    const handleRouteChangeComplete = () => {
      html.classList.remove('js-loading');
    };
    
    router.events.on('routeChangeComplete', handleRouteChangeComplete);
    
    return () => {
      clearTimeout(globalTimeout);
      router.events.off('routeChangeComplete', handleRouteChangeComplete);
    };
  }, [router, isAdminRoute]);

  return (
    <AuthProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#1a1f2e" />
      </Head>
      
      {/* Critical fix for Vercel tab switching issues - inject direct browser intervention */}
      <Script id="prevent-page-refresh" strategy="afterInteractive">
        {`
          // Direct browser intervention to prevent refresh on tab switch
          (function() {
            // Override the fetch API to cache responses
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
              // Only cache API requests with GET method to Supabase
              if (args[0] && args[0].toString().includes('supabase') && 
                  (!args[1] || args[1].method === 'GET' || !args[1].method)) {
                try {
                  const cacheKey = 'aditi_fetch_' + args[0].toString();
                  const cachedResponse = sessionStorage.getItem(cacheKey);
                  if (cachedResponse && document.visibilityState === 'visible') {
                    // Use cached response for tab switches
                    console.log('Using cached API response for', args[0]);
                    return Promise.resolve(new Response(cachedResponse, {
                      status: 200,
                      headers: { 'Content-Type': 'application/json' }
                    }));
                  }

                  return originalFetch.apply(this, args).then(response => {
                    if (response.ok) {
                      // Clone and cache successful responses
                      response.clone().text().then(text => {
                        try {
                          sessionStorage.setItem(cacheKey, text);
                        } catch (e) {
                          console.warn('Failed to cache response:', e);
                        }
                      });
                    }
                    return response;
                  });
                } catch (e) {
                  console.warn('Error in fetch override:', e);
                  return originalFetch.apply(this, args);
                }
              }
              return originalFetch.apply(this, args);
            };

            // Detect and prevent unnecessary page reloads 
            document.addEventListener('visibilitychange', function(e) {
              if (document.visibilityState === 'visible') {
                // Cancel any pending requests if they exist
                if (window.stop) window.stop();
                
                // Mark tabs as needing no refresh
                window.__ADITI_PREVENT_REFRESH = true;
                
                // Prevent the default reload behavior
                e.preventDefault?.();
                if (e.stopPropagation) e.stopPropagation();
                if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                return false;
              }
            }, true);

            // Override the reload function on critical pages
            const originalReload = window.location.reload;
            window.location.reload = function() {
              // Only allow explicit reloads, not automatic ones from tab switching
              if (window.__ADITI_PREVENT_REFRESH && !window.__ADITI_USER_INITIATED_RELOAD) {
                console.log('Prevented automatic page reload');
                return false;
              }
              return originalReload.apply(this, arguments);
            };
          })();
        `}
      </Script>
      
      <Component {...pageProps} key={`page-${router.asPath}-${pageTabRefreshPrevented ? 'preserved' : forceRerender}`} />
      <Toaster position="top-right" toastOptions={{
        style: {
          background: '#1a1f2e',
          color: '#ffffff',
        },
        success: {
          duration: 3000,
        },
        error: {
          duration: 4000,
        },
      }} />
    </AuthProvider>
  );
}
