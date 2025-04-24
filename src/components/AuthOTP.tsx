import { useState, useEffect } from 'react';
import { supabase, checkAuthToken } from '../lib/supabaseClient';
import { toast } from 'react-hot-toast';
import { useRouter } from 'next/router';
import { USER_CACHE_KEY } from '../lib/authContext';

export default function AuthOTP() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const router = useRouter();

  // Check for authentication hash in URL on component mount
  useEffect(() => {
    const { hash } = window.location;
    
    // If we have a hash in the URL, it means we're being redirected back after magic link click
    if (hash && hash.includes('access_token')) {
      // Clear the hash from the URL to prevent issues with multiple token processing
      if (window.history.replaceState) {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
      
      console.log('Magic link authentication detected in URL');
      setIsLoading(true);
      
      // Process the auth callback
      (async () => {
        try {
          // Get the current session
          const { data, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Error getting session after magic link:', error);
            toast.error('Failed to authenticate. Please try again.');
            return;
          }
          
          if (data?.session) {
            console.log('Authentication successful, session established');
            
            // Manually extend token validity to prevent issues
            try {
              const tokenStr = localStorage.getItem('supabase.auth.token');
              if (tokenStr) {
                const token = JSON.parse(tokenStr);
                if (token) {
                  // Update token expiry to 100 years
                  const TOKEN_VALIDITY_PERIOD = 3153600000000;
                  token.expires_at = Date.now() + TOKEN_VALIDITY_PERIOD;
                  token.expires_in = TOKEN_VALIDITY_PERIOD / 1000;
                  localStorage.setItem('supabase.auth.token', JSON.stringify(token));
                  console.log('Extended token lifetime after magic link auth');
                }
              }
              
              // Also check the token status for debugging
              checkAuthToken();
              
              // Set last session check timestamp
              localStorage.setItem('aditi_last_session_check', Date.now().toString());
              
              // Force redirect to dashboard after successful auth
              setTimeout(() => {
                router.push('/dashboard');
              }, 1500);
              
              toast.success('Login successful! Redirecting...');
            } catch (err) {
              console.error('Error extending token lifetime after magic link auth:', err);
            }
          }
        } finally {
          setIsLoading(false);
        }
      })();
    }
  }, [router]);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    
    setIsLoading(true);
    
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: window.location.origin,
          shouldCreateUser: true,
        },
      });
      
      if (error) throw error;
      
      setOtpSent(true);
      toast.success('OTP sent to your email. Please check your inbox.');
    } catch (error: any) {
      console.error('OTP error:', error);
      toast.error(error.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#1a1f2e] px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8 bg-[#1e2538] p-8 rounded-xl shadow-2xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
            {otpSent ? 'Check your email' : 'Sign in to your account'}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-300">
            {otpSent 
              ? 'We\'ve sent a magic link to your email. Click the link to sign in.' 
              : 'Enter your email to receive a one-time password'}
          </p>
        </div>
        
        {!otpSent ? (
          <form className="mt-8 space-y-6" onSubmit={handleSendOTP}>
            <div className="rounded-md -space-y-px">
              <div>
                <label htmlFor="email-address" className="sr-only">Email address</label>
                <input
                  id="email-address"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="appearance-none rounded-lg relative block w-full px-3 py-3 border border-gray-600 placeholder-gray-400 text-white bg-[#262d40] focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 disabled:opacity-70 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {isLoading ? 'Sending...' : 'Send Magic Link'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-8 text-center">
            <div className="rounded-full mx-auto w-20 h-20 bg-purple-900 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-purple-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="mt-4 text-sm text-gray-300">
              The magic link will expire in 10 minutes. If you don't see the email, please check your spam folder.
            </p>
            <button
              onClick={() => setOtpSent(false)}
              className="mt-6 text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors duration-200"
            >
              Try again with a different email
            </button>
          </div>
        )}

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-600"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-[#1e2538] text-gray-400">
                Secure login powered by Supabase
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 