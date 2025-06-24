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

  useEffect(() => {
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

    fetchCases();
  }, []);

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <h1 className="text-4xl font-bold mb-8 text-center">Case Management</h1>

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
              <div className="text-center py-8 text-muted-foreground">No cases found. Start a new analysis to add one!</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Case Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Updated</TableHead>
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
                          "outline"
                        }>
                          {caseItem.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{new Date(caseItem.last_updated).toLocaleDateString()}</TableCell>
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