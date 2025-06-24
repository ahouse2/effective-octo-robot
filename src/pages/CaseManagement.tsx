import React from "react";
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

// Mock data for cases
const cases = [
  {
    id: "case-001",
    name: "Doe v. Smith Divorce",
    type: "Divorce",
    status: "Analysis Complete",
    lastUpdated: "2023-10-26",
  },
  {
    id: "case-002",
    name: "Johnson Child Custody",
    type: "Child Custody",
    status: "In Progress",
    lastUpdated: "2023-10-25",
  },
  {
    id: "case-003",
    name: "Perez Paternity Dispute",
    type: "Paternity",
    status: "Pending Upload",
    lastUpdated: "2023-10-20",
  },
  {
    id: "case-004",
    name: "Williams Spousal Support",
    type: "Spousal Support",
    status: "Analysis Complete",
    lastUpdated: "2023-10-18",
  },
];

const CaseManagement = () => {
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
                    <TableCell>{caseItem.lastUpdated}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default CaseManagement;