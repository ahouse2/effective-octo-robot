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
import { NewCaseDialog } from "@/components/NewCaseDialog";
import { Link, useNavigate } from "react-router-dom";
import { DeleteCaseDialog } from "@/components/DeleteCaseDialog";
import { Settings } from "lucide-react";
import { Input } from "@/components/ui/input";

interface Case {
  id: string;
  name: string;
  type: string;
  status: string;
  last_updated: string;
}

const MyCases = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const navigate = useNavigate();

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
    toast.success("Case created! Navigating to analysis...");
  };

  const filteredCases = cases.filter(
    (caseItem) =>
      caseItem.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      caseItem.type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <h1 className="text-4xl font-bold">My Cases</h1>
          <div className="flex items-center space-x-4 w-full md:w-auto">
            <Input
              placeholder="Search cases by name or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
            <NewCaseDialog onCaseCreated={handleCaseCreated} />
          </div>
        </div>

        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle>All Your Cases</CardTitle>
            <CardDescription>Create, view, and manage all your family law cases.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">Loading cases...</div>
            ) : error ? (
              <div className="text-center py-8 text-red-500">{error}</div>
            ) : filteredCases.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? "No cases found matching your search." : "No cases found. Click 'Create New Case' to add one!"}
              </div>
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
                  {filteredCases.map((caseItem) => (
                    <TableRow
                      key={caseItem.id}
                      onClick={() => navigate(`/agent-interaction/${caseItem.id}`)}
                      className="cursor-pointer hover:bg-muted/50"
                    >
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
                        <div
                          className="flex items-center justify-end space-x-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link to={`/case-details/${caseItem.id}`}>
                            <Button variant="outline" size="sm">
                              <Settings className="h-4 w-4" />
                            </Button>
                          </Link>
                          <DeleteCaseDialog caseId={caseItem.id} caseName={caseItem.name} />
                        </div>
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

export default MyCases;