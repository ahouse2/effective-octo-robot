import React, { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ForceGraph2D from 'react-force-graph-2d';
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

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

const GraphAnalysis = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fgRef = useRef();

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided.");
      setLoading(false);
      return;
    }

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
          throw new Error("No graph data found for this case. Have you exported it to Neo4j yet?");
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

    fetchGraphData();
  }, [caseId]);

  const getNodeColor = (node: GraphNode) => {
    switch (node.label) {
      case 'Case': return '#ff4d4d';
      case 'File': return '#4d79ff';
      case 'Category': return '#ffc14d';
      case 'Tag': return '#4dffc1';
      case 'Insight': return '#c14dff';
      default: return '#808080';
    }
  };

  return (
    <Layout>
      <div className="container mx-auto py-8 h-full flex flex-col">
        <div className="flex items-center mb-4">
          <Button asChild variant="ghost" className="mr-4">
            <Link to={`/agent-interaction/${caseId}`}>
              <ArrowLeft className="h-5 w-5 mr-2" /> Back to Case
            </Link>
          </Button>
          <h1 className="text-4xl font-bold">Case Graph Analysis</h1>
        </div>
        <div className="flex-grow border rounded-lg overflow-hidden relative bg-gray-50 dark:bg-gray-900">
          {loading && <div className="absolute inset-0 flex items-center justify-center bg-background/50"><p>Loading graph...</p></div>}
          {error && <div className="absolute inset-0 flex items-center justify-center bg-background/50"><p className="text-destructive">{error}</p></div>}
          {!loading && !error && (
            <ForceGraph2D
              ref={fgRef}
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
                ctx.fillText(label, node.x, node.y + 8);
              }}
              nodePointerAreaPaint={(node, color, ctx) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI, false);
                ctx.fill();
              }}
            />
          )}
        </div>
      </div>
    </Layout>
  );
};

export default GraphAnalysis;