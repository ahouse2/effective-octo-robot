import React, { useEffect, useState } from "react";
import { AgentActivityCard } from "./AgentActivityCard";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface AgentActivity {
  id: string;
  agent_name: string;
  agent_role: string;
  activity_type: string;
  content: string;
  timestamp: string;
  status: "processing" | "completed" | "error";
}

interface AgentActivityLogProps {
  caseId: string;
}

export const AgentActivityLog: React.FC<AgentActivityLogProps> = ({ caseId }) => {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for agent activities.");
      setLoading(false);
      return;
    }

    const fetchAgentActivities = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("agent_activities")
        .select("*")
        .eq("case_id", caseId)
        .order("timestamp", { ascending: false }); // Changed to descending

      if (error) {
        console.error("Error fetching agent activities:", error);
        setError("Failed to load agent activities. Please try again.");
        toast.error("Failed to load agent activities.");
      } else {
        setActivities(data || []);
      }
      setLoading(false);
    };

    fetchAgentActivities();

    // Real-time subscription for new activities
    const channel = supabase
      .channel(`agent_activities_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_activities', filter: `case_id=eq.${caseId}` },
        (payload) => {
          console.log('Change received!', payload);
          if (payload.eventType === 'INSERT') {
            // Add new activity to the top of the list
            setActivities((prev) => [payload.new as AgentActivity, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setActivities((prev) =>
              prev.map((activity) =>
                activity.id === payload.old.id ? (payload.new as AgentActivity) : activity
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId]);

  if (loading) {
    return <div className="text-center py-8">Loading agent activities...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  if (activities.length === 0) {
    return <div className="text-center py-8 text-muted-foreground">No agent activities found for this case.</div>;
  }

  return (
    <div className="space-y-4">
      {activities.map((activity) => (
        <AgentActivityCard
          key={activity.id}
          agentName={activity.agent_name}
          agentRole={activity.agent_role || "Agent"}
          activityType={activity.activity_type}
          content={activity.content}
          timestamp={new Date(activity.timestamp).toLocaleString()}
          status={activity.status as "processing" | "completed" | "error"}
        />
      ))}
    </div>
  );
};