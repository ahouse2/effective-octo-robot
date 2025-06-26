import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { FileText, Gavel, Clock, PlusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Case {
  id: string;
  name: string;
  type: string;
  status: string;
  last_updated: string;
}

const Dashboard = () => {
  const [totalCases, setTotalCases] = useState(0);
  const [casesInProgress, setCasesInProgress] = useState(0);
  const [analysesCompleted, setAnalysesCompleted] = useState(0);
  const [recentActivities, setRecentActivities] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("cases")
        .select("*")
        .order("last_updated", { ascending: false });

      if (error) {
        console.error("Error fetching dashboard data:", error);
        setError("Failed to load dashboard data. Please try again.");
        toast.error("Failed to load dashboard data.");
      } else {
        const allCases: Case[] = data || [];
        setTotalCases(allCases.length);
        setCasesInProgress(allCases.filter(c => c.status === "In Progress").length);
        setAnalysesCompleted(allCases.filter(c => c.status === "Analysis Complete").length);
        setRecentActivities(allCases.slice(0, 3)); // Show up to 3 most recent activities
      }
      setLoading(false);
    };

    fetchDashboardData();
  }, []);

  const renderDashboardContent = () => {
    if (totalCases === 0) {
      return (
        <Card className="max-w-3xl mx-auto text-center py-12 px-6 bg-gradient-to-br from-background to-muted/50">
          <CardHeader>
            <div className="mx-auto bg-primary/10 text-primary h-16 w-16 rounded-full flex items-center justify-center mb-4">
              <Gavel className="h-8 w-8" />
            </div>
            <CardTitle className="text-3xl font-bold">Welcome to Family Law AI</CardTitle>
            <CardDescription className="text-lg text-muted-foreground mt-2">
              Your specialized tool for evidence analysis in California family law cases.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-8">
              It looks like you don't have any cases yet. Get started by creating your first case, uploading your evidence, and letting our AI agents handle the analysis.
            </p>
            <Link to="/my-cases">
              <Button size="lg">
                <PlusCircle className="mr-2 h-5 w-5" />
                Create Your First Case
              </Button>
            </Link>
          </CardContent>
        </Card>
      );
    }

    return (
      <>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 max-w-4xl mx-auto">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
              <Gavel className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCases}</div>
              <p className="text-xs text-muted-foreground">
                All cases managed
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{casesInProgress}</div>
              <p className="text-xs text-muted-foreground">
                Analyses currently running
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed Analyses</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analysesCompleted}</div>
              <p className="text-xs text-muted-foreground">
                Analyses successfully finished
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity Section */}
        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>A summary of the most recently updated cases.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivities.length > 0 ? (
              <ul className="space-y-4">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{activity.status}: <span className="text-primary">{activity.name}</span></p>
                      <p className="text-sm text-muted-foreground">{new Date(activity.last_updated).toLocaleDateString()}</p>
                    </div>
                    <Link to={`/agent-interaction/${activity.id}`}>
                      <Button variant="outline" size="sm">View Analysis</Button>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No recent activity.</div>
            )}
            <Separator className="my-6" />
            <div className="flex justify-center space-x-4">
              <Link to="/my-cases">
                <Button>Create New Case</Button>
              </Link>
              <Link to="/my-cases">
                <Button variant="outline">View All Cases</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Dashboard</h1>

        {loading ? (
          <div className="text-center py-8">Loading dashboard data...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">{error}</div>
        ) : (
          renderDashboardContent()
        )}
      </div>
    </Layout>
  );
};

export default Dashboard;