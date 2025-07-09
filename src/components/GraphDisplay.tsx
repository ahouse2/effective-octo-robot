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
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);

  const fetchGraphData = async () => {
    setLoading(true);
    setError(null);
    const loadingToastId = toast.loading("Fetching graph data from Neo4j...");

    try {
      const { data, error: functionError } = await supabase.functions.invoke('get-neo4j-graph', {
        body: { caseId },
      });

      if (functionError) throw functionError;
      if (data.error) throw new Error(data.error);
      if (!data || !data.nodes || data.nodes.length === 0) {
        throw new Error("No graph data found for this case. Have you exported it to Neo4j yet from the 'Tools' tab?");
      }

      setGraphData(data);
      toast.success("Graph data loaded successfully!", { id: loadingToastId });
    } catch (err: any) {
      console.error("Error fetching graph data:", err);
      setError(err.message || "Failed to load graph data.");
      toast.error(err.message || "Failed to load graph data.", { id: loadingToastId });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided.");
      setLoading(false);
      return;
    }
    fetchGraphData();
  }, [caseId]);

  const getNodeColor = (node: GraphNode) => {
    switch (node.label) {
      case 'Case': return '#ff4d4d'; // Red
      case 'File': return '#4d79ff'; // Blue
      case 'Category': return '#ffc14d'; // Orange
      case 'Tag': return '#4dffc1'; // Green
      case 'Insight': return '#c14dff'; // Purple
      default: return '#808080'; // Gray
    }
  };

  const handleExportImage = () => {
    if (graphContainerRef.current) {
      const canvas = graphContainerRef.current.querySelector('canvas');
      if (canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `graph_analysis_case_${caseId}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("Graph image saved successfully!");
      } else {
        toast.error("Could not find graph canvas to export.");
      }
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle>Knowledge Graph</CardTitle>
            <CardDescription>Visual representation of entities and relationships within your case.</CardDescription>
          </div>
          <div className="flex space-x-2">
            <Button onClick={fetchGraphData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Refresh Graph
            </Button>
            <Button onClick={handleExportImage} disabled={loading || !!error || graphData.nodes.length === 0}>
              <Camera className="h-4 w-4 mr-2" />
              Save as PNG
            </Button>
            <Button asChild variant="outline">
              <Link to={`/graph-analysis/${caseId}`}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Full View
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div ref={graphContainerRef} className="h-full w-full border rounded-lg overflow-hidden relative bg-gray-50 dark:bg-gray-900">
          {loading && <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10"><p className="text-muted-foreground">Loading graph...</p></div>}
          {error && <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/50 z-10 p-4"><p className="text-destructive text-center">{error}</p><p className="text-sm text-muted-foreground mt-2">Ensure you have exported data to Neo4j from the 'Tools' tab.</p></div>}
          {!loading && !error && graphData.nodes.length > 0 && (
            <ForceGraph2D
              graphData={graphData}
              nodeLabel="name"
              nodeAutoColorBy="label"
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              linkCurvature={0.25}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = node.name || '';
                const fontSize = 12 / globalScale;
                ctx.font = `${fontSize}px Sans-Serif`;
                
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = getNodeColor(node as GraphNode);
                ctx.fillText(label, node.x as number, (node.y as number) + 8);
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x as number, node.y as number, 5, 0, 2 * Math.PI, false);
                ctx.fill();
              }}
              width={graphContainerRef.current?.clientWidth || 600}
              height={graphContainerRef.current?.clientHeight || 400}
            />
          )}
          {!loading && !error && graphData.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground p-4">
              <p className="text-lg font-semibold mb-2">No Graph Data Available</p>
              <p className="text-center">Export your case data to Neo4j from the "Tools" tab to generate a knowledge graph.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};