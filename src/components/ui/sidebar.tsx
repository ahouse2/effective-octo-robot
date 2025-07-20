import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FolderKanban, Gavel, User, LogOut, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SidebarThemeToggle } from "./SidebarThemeToggle"; // Import the new component

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Sidebar({ className }: SidebarProps) {
  const location = useLocation();

  const handleSignOut = async () => {
    const loadingToastId = toast.loading("Signing out...");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw new Error(error.message);
      }
      toast.success("Signed out successfully!");
    } catch (err: any) {
      console.error("Sign out error:", err);
      toast.error(err.message || "Failed to sign out. Please try again.");
    } finally {
      toast.dismiss(loadingToastId);
    }
  };

  const navLinks = [
    { to: "/dashboard", icon: FolderKanban, text: "Dashboard" },
    { to: "/my-cases", icon: Gavel, text: "My Cases" },
  ];

  const accountLinks = [
    { to: "/ai-settings", icon: User, text: "AI & Profile" },
  ];

  return (
    <div className={cn("flex h-full max-h-screen flex-col gap-2", className)}>
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold text-foreground">
          <Scale className="h-6 w-6 text-primary" />
          <span className="">Family Law AI</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto">
        <nav className="grid items-start px-2 py-4 text-sm font-medium lg:px-4">
          {navLinks.map(link => (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                location.pathname.startsWith(link.to) && "bg-accent text-primary"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.text}
            </Link>
          ))}
        </nav>
        <div className="px-2 lg:px-4 mt-4">
          <h2 className="mb-2 px-3 text-lg font-semibold tracking-tight">
            Account
          </h2>
          <div className="space-y-1">
            {accountLinks.map(link => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-all hover:text-primary",
                  location.pathname.startsWith(link.to) && "bg-accent text-primary"
                )}
              >
                <link.icon className="h-4 w-4" />
                {link.text}
              </Link>
            ))}
            <SidebarThemeToggle /> {/* Use the new component */}
          </div>
        </div>
      </div>
      <div className="mt-auto p-4 border-t">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:text-destructive" onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}