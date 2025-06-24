import React from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { FileText, Gavel, Clock } from "lucide-react";

const Dashboard = () => {
  // Mock data for dashboard summaries
  const totalCases = 12;
  const casesInProgress = 3;
  const analysesCompleted = 9;

  // Mock data for recent activity
  const recentActivities = [
    { id: 1, type: "Analysis Complete", caseName: "Doe v. Smith Divorce", date: "2023-10-26" },
    { id: 2, type: "New Files Uploaded", caseName: "Johnson Child Custody", date: "2023-10-25" },
    { id: 3, type: "Case Created", caseName: "Perez Paternity Dispute", date: "2023-10-20" },
  ];

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Dashboard</h1>

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
          </CardHeader>
          <CardContent>
            {recentActivities.length > 0 ? (
              <ul className="space-y-4">
                {recentActivities.map((activity) => (
                  <li key={activity.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{activity.type}: <span className="text-primary">{activity.caseName}</span></p>
                      <p className="text-sm text-muted-foreground">{activity.date}</p>
                    </div>
                    <Button variant="outline" size="sm">View Case</Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No recent activity.</p>
            )}
            <Separator className="my-6" />
            <div className="flex justify-center space-x-4">
              <Link to="/evidence-analysis">
                <Button>Start New Analysis</Button>
              </Link>
              <Link to="/case-management">
                <Button variant="outline">View All Cases</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Dashboard;