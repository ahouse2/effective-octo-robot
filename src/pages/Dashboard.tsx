import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
        setRecentActivities(allCases.slice(0, 5));
      }
      setLoading(false);
    };

    fetchDashboardData();
  }, []);

  const renderDashboardContent = () => {
    if (totalCases === 0 && !loading) {
      return (
        <div className="text-center py-16 px-6">
          <div className="mx-auto bg-primary/10 text-primary h-16 w-16 rounded-full flex items-center justify-center mb-4">
            <Gavel className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold">Welcome to Your Legal Dashboard</h1>
          <p className="text-lg text-muted-foreground mt-2 max-w-2xl mx-auto">
            Streamline your case management. Start by creating your first case to unlock AI-powered analysis and insights.
          </p>
          <div className="mt-8">
            <Link to="/my-cases">
              <Button size="lg">
                <PlusCircle className="mr-2 h-5 w-5" />
                Create Your First Case
              </Button>
            </Link>
          </div>
        </div>
      );
    }

    return (
      <>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="high-end-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
              <Gavel className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalCases}</div>
            </CardContent>
          </Card>
          <Card className="high-end-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">In Progress</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{casesInProgress}</div>
            </CardContent>
          </Card>
          <Card className="high-end-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analysesCompleted}</div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity Section */}
        <Card className="high-end-card">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>The most recently updated cases.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivities.length > 0 ? (
              <ul className="space-y-2">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                    <div>
                      <p className="font-medium text-primary">{activity.name}</p>
                      <p className="text-sm text-muted-foreground">{activity.status} - {new Date(activity.last_updated).toLocaleDateString()}</p>
                    </div>
                    <Link to={`/agent-interaction/${activity.id}`}>
                      <Button variant="outline" size="sm">View</Button>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No recent activity.</div>
            )}
          </CardContent>
        </Card>
      </>
    );
  };

  return (
    <Layout>
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <Link to="/my-cases">
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" />
              New Case
            </Button>
          </Link>
        </div>

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