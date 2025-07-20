import React, { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ForceGraph2D from 'react-force-graph-2d';
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Camera, ExternalLink, RefreshCw } from "lucide-react"; // Added RefreshCw

interface GraphNode {
  id: string;
  name: string;
  label: string;
}

interface GraphLink {
  source: string;
  target: string;
  label: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface GraphDisplayProps {
  caseId: string;
}

export const GraphDisplay: React.FC<GraphDisplayProps> = ({ caseId }) => {
  // Removed state for graphData, loading, error as we are no longer fetching here
  // const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  // const [loading, setLoading] = useState(true);
  // const [error, setError] = useState<string | null>(null);
  // const graphContainerRef = useRef<HTMLDivElement>(null); // No longer needed for ForceGraph2D

  // Removed useEffect for fetching graph data

  // Removed getNodeColor and handleExportImage as ForceGraph2D is no longer used here

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Knowledge Graph</CardTitle>
            <CardDescription>Visual representation of entities and relationships within your case.</CardDescription>
          </div>
          <div className="flex space-x-2">
            {/* Removed Refresh Graph and Save as PNG buttons */}
            <Button asChild variant="default">
              <Link to={`/graph-analysis/${caseId}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                View Full Graph
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-lg font-semibold mb-2">Graph Visualization Available</p>
          <p className="text-muted-foreground mb-4">
            For an interactive and detailed view of your case's knowledge graph, please click the button below.
            Ensure you have exported your case data to Neo4j from the "Tools" tab first.
          </p>
          <Button asChild variant="default">
            <Link to={`/graph-analysis/${caseId}`}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Go to Full Graph View
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};