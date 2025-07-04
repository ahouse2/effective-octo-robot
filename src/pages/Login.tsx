import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/integrations/supabase/client';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Scale } from 'lucide-react';
import { Card } from '@/components/ui/card';

const Login = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        navigate('/');
        toast.success("Logged in successfully!");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Scale className="mx-auto h-12 w-12 text-primary" />
          <h2 className="mt-6 text-center text-3xl font-extrabold text-foreground">
            Family Law AI
          </h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Sign in to access your case dashboard
          </p>
        </div>
        <Card className="p-8 high-end-card">
          <Auth
            supabaseClient={supabase}
            providers={[]}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: 'hsl(var(--primary))',
                    brandAccent: 'hsl(var(--primary-foreground))',
                    defaultButtonBackground: 'hsl(var(--background))',
                    defaultButtonBackgroundHover: 'hsl(var(--muted))',
                    defaultButtonBorder: 'hsl(var(--border))',
                    defaultButtonText: 'hsl(var(--foreground))',
                    inputBackground: 'hsl(var(--background))',
                    inputBorder: 'hsl(var(--input))',
                    inputBorderHover: 'hsl(var(--ring))',
                    inputText: 'hsl(var(--foreground))',
                    inputLabelText: 'hsl(var(--foreground))',
                    inputPlaceholder: 'hsl(var(--muted-foreground))',
                  },
                  radii: {
                    buttonBorderRadius: 'var(--radius)',
                  }
                },
              },
            }}
            theme="dark"
            redirectTo={window.location.origin}
          />
        </Card>
      </div>
    </div>
  );
};

export default Login;