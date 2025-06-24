import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface TimelineEvent {
  id: string;
  timestamp: Date;
  title: string;
  description: string;
  type: 'activity' | 'theory_update';
}

interface CaseTimelineProps {
  caseId: string;
}

export const CaseTimeline: React.FC<CaseTimelineProps> = ({ caseId }) => {
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for timeline.");
      setLoading(false);
      return;
    }

    const fetchTimelineData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch agent activities
        const { data: activitiesData, error: activitiesError } = await supabase
          .from("agent_activities")
          .select("id, timestamp, agent_name, activity_type, content")
          .eq("case_id", caseId);

        if (activitiesError) throw activitiesError;

        const activityEvents: TimelineEvent[] = (activitiesData || []).map(activity => ({
          id: activity.id,
          timestamp: new Date(activity.timestamp),
          title: `${activity.agent_name}: ${activity.activity_type}`,
          description: activity.content,
          type: 'activity',
        }));

        // Fetch case theory updates
        const { data: theoryData, error: theoryError } = await supabase
          .from("case_theories")
          .select("id, last_updated, status")
          .eq("case_id", caseId)
          .single(); // Assuming one theory per case

        let theoryEvents: TimelineEvent[] = [];
        if (theoryData) {
          theoryEvents.push({
            id: theoryData.id + '-theory-update',
            timestamp: new Date(theoryData.last_updated),
            title: `Case Theory Updated`,
            description: `Status: ${theoryData.status}.`,
            type: 'theory_update',
          });
        } else if (theoryError && theoryError.code !== 'PGRST116') { // PGRST116 means no rows found
          throw theoryError;
        }

        // Combine and sort events by timestamp
        const combinedEvents = [...activityEvents, ...theoryEvents].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        setTimelineEvents(combinedEvents);

      } catch (err: any) {
        console.error("Error fetching timeline data:", err);
        setError("Failed to load timeline data. Please try again.");
        toast.error("Failed to load timeline data.");
      } finally {
        setLoading(false);
      }
    };

    fetchTimelineData();

    // Real-time subscription for agent activities
    const activitiesChannel = supabase
      .channel(`timeline_activities_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agent_activities', filter: `case_id=eq.${caseId}` },
        (payload) => {
          console.log('Timeline activity change received!', payload);
          if (payload.eventType === 'INSERT') {
            setTimelineEvents((prev) => {
              const newEvent: TimelineEvent = {
                id: payload.new.id,
                timestamp: new Date(payload.new.timestamp),
                title: `${payload.new.agent_name}: ${payload.new.activity_type}`,
                description: payload.new.content,
                type: 'activity',
              };
              const updatedEvents = [...prev, newEvent].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
              return updatedEvents;
            });
          } else if (payload.eventType === 'UPDATE') {
            setTimelineEvents((prev) => {
              const updatedEvent: TimelineEvent = {
                id: payload.new.id,
                timestamp: new Date(payload.new.timestamp),
                title: `${payload.new.agent_name}: ${payload.new.activity_type}`,
                description: payload.new.content,
                type: 'activity',
              };
              const updatedEvents = prev.map((event) =>
                event.id === payload.old.id && event.type === 'activity' ? updatedEvent : event
              ).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
              return updatedEvents;
            });
          }
        }
      )
      .subscribe();

    // Real-time subscription for case theory updates
    const theoryChannel = supabase
      .channel(`timeline_theories_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'case_theories', filter: `case_id=eq.${caseId}` },
        (payload) => {
          console.log('Timeline theory change received!', payload);
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            setTimelineEvents((prev) => {
              const newTheoryEvent: TimelineEvent = {
                id: payload.new.id + '-theory-update',
                timestamp: new Date(payload.new.last_updated),
                title: `Case Theory Updated`,
                description: `Status: ${payload.new.status}.`,
                type: 'theory_update',
              };
              // Remove old theory update event if exists, then add new one
              const filteredPrev = prev.filter(e => !(e.id === payload.old.id + '-theory-update' && e.type === 'theory_update'));
              const updatedEvents = [...filteredPrev, newTheoryEvent].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
              return updatedEvents;
            });
          } else if (payload.eventType === 'DELETE') {
            setTimelineEvents((prev) => prev.filter(e => !(e.id === payload.old.id + '-theory-update' && e.type === 'theory_update')));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(activitiesChannel);
      supabase.removeChannel(theoryChannel);
    };
  }, [caseId]);

  if (loading) {
    return <div className="text-center py-8">Loading timeline...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Case Timeline</CardTitle>
        <CardDescription>Key events and updates in the case analysis.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4"> {/* Adjust height as needed */}
          {timelineEvents.length > 0 ? (
            <div className="relative pl-6 border-l-2 border-gray-200 dark:border-gray-700">
              {timelineEvents.map((event, index) => (
                <div key={event.id} className="mb-8 last:mb-0">
                  <div className="absolute -left-2.5 mt-1 h-4 w-4 rounded-full bg-primary border-2 border-background" />
                  <div className="ml-4">
                    <p className="text-xs text-muted-foreground">
                      {format(event.timestamp, "MMM dd, yyyy HH:mm")}
                    </p>
                    <h3 className="font-semibold text-foreground mt-1">{event.title}</h3>
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center py-4 text-muted-foreground">
              No timeline events yet. Analysis will generate events here.
            </p>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};