import React, { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NewCaseDialog } from "@/components/NewCaseDialog"; // Import the new dialog component
import { Link } from "react-router-dom"; // Import Link for navigation

interface Case {
  id: string;
  name: string;
  type: string;
  status: string;
  last_updated: string;
}

const CaseManagement = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCases = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("cases")
      .select("*")
      .order("last_updated", { ascending: false });

    if (error) {
      console.error("Error fetching cases:", error);
      setError("Failed to load cases. Please try again.");
      toast.error("Failed to load cases.");
    } else {
      setCases(data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchCases();

    // Real-time subscription for new cases
    const channel = supabase
      .channel('cases_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases' },
        (payload) => {
          console.log('Case change received!', payload);
          if (payload.eventType === 'INSERT') {
            setCases((prev) => [payload.new as Case, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setCases((prev) =>
              prev.map((caseItem) =>
                caseItem.id === payload.old.id ? (payload.new as Case) : caseItem
              )
            );
          } else if (payload.eventType === 'DELETE') {
            setCases((prev) => prev.filter((caseItem) => caseItem.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleCaseCreated = (newCaseId: string) => {
    // Optionally re-fetch cases or rely on real-time subscription
    // fetchCases(); // If not using real-time, uncomment this
    toast.success("Case created! Navigating to analysis...");
    // The NewCaseDialog already handles navigation, but if you wanted to do something else here, you could.
  };

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold">Case Management</h1>
          <NewCaseDialog onCaseCreated={handleCaseCreated} />
        </div>

        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle>Your Cases</CardTitle>
            <CardDescription>Overview of all your family law cases and their analysis status.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading cases...</div>
            ) : error ? (
              <div className="text-center py-8 text-red-500">{error}</div>
            ) : cases.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No cases found. Click "Create New Case" to add one!</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.map((caseItem) => (
                    <TableRow key={caseItem.id}>
                      <TableCell className="font-medium">{caseItem.name}</TableCell>
                      <TableCell>{caseItem.type}</TableCell>
                      <TableCell>
                        <Badge variant={
                          caseItem.status === "Analysis Complete" ? "default" :
                          caseItem.status === "In Progress" ? "secondary" :
                          caseItem.status === "Initial Setup" ? "outline" :
                          "outline"
                        }>
                          {caseItem.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(caseItem.last_updated).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Link to={`/agent-interaction/${caseItem.id}`}>
                          <Button variant="outline" size="sm">View Analysis</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default CaseManagement;