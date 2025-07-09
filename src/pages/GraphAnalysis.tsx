import React, { useEffect, useState, useRef } from "react";
import Layout from "@/components/Layout";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Neo4jGraphViewer from "@/components/Neo4jGraphViewer"; // Import the new component
import { toast } from "sonner"; // Import toast for warnings

const GraphAnalysis = () => {
  const { caseId } = useParams<{ caseId: string }>();
  const [dbId, setDbId] = useState<string | null>(null);
  // WARNING: For security, the Neo4j password should NOT be stored or passed directly to the frontend.
  // This is a placeholder. You would need to manually provide it here for neovis.js to connect directly.
  // Example: const neo4jPassword = "YOUR_NEO4J_PASSWORD_HERE";
  const neo4jPassword = "vJ0GWzj_pyjTP9AMENLR0fCbdEvoznIRCSWmTwk-Fjo"; // Your provided password

  useEffect(() => {
    // Extract dbId from VITE_NEO4J_CONNECTION_URI environment variable
    const connectionUri = import.meta.env.VITE_NEO4J_CONNECTION_URI;
    if (connectionUri) {
      try {
        const url = new URL(connectionUri);
        // Expected format: neo4j+s://<dbId>.databases.neo4j.io:7687
        const hostnameParts = url.hostname.split('.');
        if (hostnameParts.length >= 3) {
          setDbId(hostnameParts[0]);
        } else {
          toast.error("Invalid NEO4J_CONNECTION_URI format. Could not extract database ID.");
          console.error("Invalid NEO4J_CONNECTION_URI format:", connectionUri);
        }
      } catch (e) {
        toast.error("Invalid NEO4J_CONNECTION_URI. Please check your .env file.");
        console.error("Error parsing NEO4J_CONNECTION_URI:", e);
      }
    } else {
      toast.warning("VITE_NEO4J_CONNECTION_URI is not set. Neo4j graph viewer may not function.");
    }
  }, []);

  return (
    <Layout>
      <div className="container mx-auto py-8 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <Button asChild variant="ghost" className="mr-4">
              <Link to={`/agent-interaction/${caseId}`}>
                <ArrowLeft className="h-5 w-5 mr-2" /> Back to Case
              </Link>
            </Button>
            <h1 className="text-4xl font-bold">Case Graph Analysis</h1>
          </div>
          {/* Removed "Save as PNG" button as neovis.js handles its own rendering */}
        </div>
        <div className="flex-grow border rounded-lg overflow-hidden relative bg-gray-50 dark:bg-gray-900 p-4">
          {dbId ? (
            <Neo4jGraphViewer dbId={dbId} serverPassword={neo4jPassword} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
              <p className="text-muted-foreground">
                Neo4j connection details missing. Please ensure `VITE_NEO4J_CONNECTION_URI` is set in your .env file.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default GraphAnalysis;