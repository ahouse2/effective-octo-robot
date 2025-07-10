import React, { useEffect, useRef } from "react";
import NeoVis from "neovis.js";
import { toast } from "sonner";

interface Neo4jGraphViewerProps {
  dbId: string;
  serverPassword?: string;
  caseId: string; // Add caseId prop
}

const Neo4jGraphViewer: React.FC<Neo4jGraphViewerProps> = ({ dbId, serverPassword, caseId }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const vizRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!dbId) {
      toast.error("Neo4j Database ID is missing. Please check your environment variables.");
      return;
    }

    if (!caseId) {
      toast.error("Case ID is missing for graph visualization.");
      return;
    }

    if (!serverPassword) {
      toast.warning("Neo4j password is not provided to Neo4jGraphViewer. Graph may not load without authentication.");
    }

    if (vizRef.current) {
      vizRef.current.clear();
      vizRef.current = null;
    }

    const config = {
      containerId: containerRef.current.id,
      neo4j: {
        serverUrl: `neo4j+s://${dbId}.databases.neo4j.io`,
        serverUser: "neo4j",
        serverPassword: serverPassword,
      },
      labels: {
        Case: { caption: "name", color: "#ff4d4d" },
        File: { caption: "suggested_name", color: "#4d79ff" },
        Category: { caption: "name", color: "#ffc14d" },
        Tag: { caption: "name", color: "#4dffc1" },
        Insight: { caption: "title", color: "#c14dff" },
        CaseTheory: { caption: "status", color: "#808080" },
      },
      relationships: {
        HAS_FILE: { caption: true, color: "#A5A5A5" },
        HAS_CATEGORY: { caption: true, color: "#A5A5A5" },
        HAS_TAG: { caption: true, color: "#A5A5A5" },
        HAS_INSIGHT: { caption: true, color: "#A5A5A5" },
        HAS_THEORY: { caption: true, color: "#A5A5A5" },
        BASED_ON_FILE: { caption: true, color: "#A5A5A5" },
      },
      initialCypher: `
        MATCH (c:Case {id: '${caseId}'})-[r]-(n) 
        OPTIONAL MATCH (n)-[r2]-(m) 
        RETURN c, r, n, r2, m 
        LIMIT 200
      `,
    };

    try {
      vizRef.current = new NeoVis(config);
      vizRef.current.render();
      toast.success("Neo4j graph viewer initialized. Ensure credentials are set and data is exported.");
    } catch (e: any) {
      console.error("Error initializing NeoVis:", e);
      toast.error(`Failed to initialize graph viewer: ${e.message}. Check console for details.`);
    }

    return () => {
      if (vizRef.current) {
        vizRef.current.clear();
        vizRef.current = null;
      }
    };
  }, [dbId, serverPassword, caseId]); // Add caseId to dependencies

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Neo4j Knowledge Graph (Direct Connection)</h2>
        <button 
          onClick={() => vizRef.current && vizRef.current.render()}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
        >
          Refresh Graph
        </button>
      </div>
      <div
        id="neo4j-graph-container"
        ref={containerRef}
        style={{ height: "calc(100% - 60px)", width: "100%", border: "1px solid var(--border)", borderRadius: "0.5rem", overflow: "hidden" }}
      />
    </div>
  );
};

export default Neo4jGraphViewer;