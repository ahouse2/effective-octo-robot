import React, { useEffect, useState, useMemo } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NewCaseDialog } from "@/components/NewCaseDialog";
import { useNavigate } from "react-router-dom";
import { DeleteCaseDialog } from "@/components/DeleteCaseDialog";
import { Settings, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

interface Case {
  id: string;
  name: string;
  type: string;
  status: string;
  last_updated: string;
  analysis_progress: number | null;
  analysis_status_message: string | null;
}

const MyCases = () => {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
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
      setCases(data as Case[] || []);
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
        () => fetchCases()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const caseTypes = useMemo(() => {
    const types = new Set(cases.map(c => c.type));
    return ["all", ...Array.from(types)];
  }, [cases]);

  const caseStatuses = useMemo(() => {
    const statuses = new Set(cases.map(c => c.status));
    return ["all", ...Array.from(statuses)];
  }, [cases]);

  const filteredCases = cases.filter(
    (caseItem) =>
      (caseItem.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      caseItem.type.toLowerCase().includes(searchTerm.toLowerCase())) &&
      (statusFilter === "all" || caseItem.status === statusFilter) &&
      (typeFilter === "all" || caseItem.type === typeFilter)
  );

  return (
    <Layout>
      <div className="container mx-auto py-8">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div>
            <h1 className="text-4xl font-bold">My Cases</h1>
            <p className="text-muted-foreground">Manage, view, and analyze your ongoing cases.</p>
          </div>
          <div className="flex items-center space-x-2 w-full md:w-auto">
            <NewCaseDialog onCaseCreated={() => fetchCases()} />
          </div>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Filter & Search</CardTitle>
            <CardDescription>Quickly find the case you're looking for.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row gap-4">
            <Input
              placeholder="Search by name or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-grow"
            />
            <div className="flex gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  {caseStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status === 'all' ? 'All Statuses' : status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  {caseTypes.map(type => (
                    <SelectItem key={type} value={type}>{type === 'all' ? 'All Types' : type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading cases...</div>
        ) : error ? (
          <div className="text-center py-8 text-red-500">{error}</div>
        ) : filteredCases.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-card border rounded-lg">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h2 className="mt-4 text-2xl font-semibold">No Cases Found</h2>
            <p className="mt-2">
              {cases.length > 0 ? "No cases match your current filters." : "Click 'Create New Case' to get started!"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCases.map((caseItem) => (
              <Card
                key={caseItem.id}
                className="flex flex-col transition-all duration-300 ease-in-out hover:shadow-lg dark:hover:shadow-primary/10"
              >
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg flex-grow min-w-0 break-words">{caseItem.name}</CardTitle>
                    <Badge variant={
                      caseItem.status === "Analysis Complete" ? "default" :
                      caseItem.status === "In Progress" ? "secondary" :
                      caseItem.status === "Error" ? "destructive" :
                      "outline"
                    } className="flex-shrink-0 ml-2">
                      {caseItem.status}
                    </Badge>
                  </div>
                  <CardDescription>{caseItem.type}</CardDescription>
                </CardHeader>
                <CardContent className="flex-grow space-y-2 py-0">
                  {caseItem.status === 'In Progress' && caseItem.analysis_progress != null && (
                    <div className="pt-2">
                      <Progress value={caseItem.analysis_progress} className="w-full h-2" />
                      <p className="text-xs text-muted-foreground mt-2 text-center">{caseItem.analysis_status_message || `${caseItem.analysis_progress}% complete`}</p>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex justify-between items-center bg-muted/50 p-3 mt-4">
                  <p className="text-xs text-muted-foreground">
                    Updated: {new Date(caseItem.last_updated).toLocaleDateString()}
                  </p>
                  <div className="flex items-center space-x-1">
                    <Button variant="default" size="sm" onClick={() => navigate(`/agent-interaction/${caseItem.id}`)}>
                      View
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/case-details/${caseItem.id}`)}>
                      <Settings className="h-4 w-4" />
                    </Button>
                    <DeleteCaseDialog caseId={caseItem.id} caseName={caseItem.name} />
                  </div>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default MyCases;