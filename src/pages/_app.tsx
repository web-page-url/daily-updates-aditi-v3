import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { Toaster } from 'react-hot-toast';
import Head from 'next/head';
import { AuthProvider } from "@/lib/authContext";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const [isAdminRoute, setIsAdminRoute] = useState(false);

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
      <Component {...pageProps} />
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
