import React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home, FolderKanban, Scale, Settings, Gavel, FileText, BotMessageSquare, User, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SidebarProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Sidebar({ className }: SidebarProps) {
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

  return (
    <div className={cn("pb-12 h-full flex flex-col", className)}>
      <div className="space-y-4 py-4 flex-1">
        <div className="px-3 py-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
            Family Law AI
          </h2>
          <div className="space-y-1">
            <Link to="/">
              <Button variant="ghost" className="w-full justify-start">
                <Home className="mr-2 h-4 w-4" />
                Home
              </Button>
            </Link>
            <Link to="/dashboard">
              <Button variant="ghost" className="w-full justify-start">
                <FolderKanban className="mr-2 h-4 w-4" />
                Dashboard
              </Button>
            </Link>
            <Link to="/evidence-analysis">
              <Button variant="ghost" className="w-full justify-start">
                <FileText className="mr-2 h-4 w-4" />
                Evidence Analysis
              </Button>
            </Link>
            <Link to="/case-management">
              <Button variant="ghost" className="w-full justify-start">
                <Gavel className="mr-2 h-4 w-4" />
                Case Management
              </Button>
            </Link>
            <Link to="/agent-interaction">
              <Button variant="ghost" className="w-full justify-start">
                <BotMessageSquare className="mr-2 h-4 w-4" />
                Agent Interaction
              </Button>
            </Link>
          </div>
        </div>
        <div className="px-3 py-2">
          <h2 className="mb-2 px-4 text-lg font-semibold tracking-tight">
            Settings
          </h2>
          <div className="space-y-1">
            <Link to="/profile">
              <Button variant="ghost" className="w-full justify-start">
                <User className="mr-2 h-4 w-4" />
                Profile
              </Button>
            </Link>
            <Link to="/app-settings"> {/* Updated Link */}
              <Button variant="ghost" className="w-full justify-start">
                <Settings className="mr-2 h-4 w-4" />
                App Settings
              </Button>
            </Link>
            <ThemeToggle />
            <Button variant="ghost" className="w-full justify-start text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
      <div className="mt-auto p-4 text-center text-sm text-gray-500">
        <a
          href="https://www.dyad.sh/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-gray-700 dark:hover:text-gray-200"
        >
          Made with Dyad
        </a>
      </div>
    </div>
  );
}