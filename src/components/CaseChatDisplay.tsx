import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Bot, User } from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "user" | "ai";
  content: string;
  timestamp: string;
}

interface CaseChatDisplayProps {
  caseId: string;
}

export const CaseChatDisplay: React.FC<CaseChatDisplayProps> = ({ caseId }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (!caseId) {
      setError("No case ID provided for chat display.");
      setLoading(false);
      return;
    }

    const fetchChatMessages = async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("agent_activities")
        .select("id, agent_name, activity_type, content, timestamp")
        .eq("case_id", caseId)
        .in("activity_type", ["User Prompt", "Response"]) // Filter for chat-relevant activities
        .order("timestamp", { ascending: true });

      if (error) {
        console.error("Error fetching chat messages:", error);
        setError("Failed to load chat messages. Please try again.");
        toast.error("Failed to load chat messages.");
      } else {
        const chatMessages: ChatMessage[] = (data || []).map((activity) => ({
          id: activity.id,
          sender: activity.activity_type === "User Prompt" ? "user" : "ai",
          content: activity.content,
          timestamp: activity.timestamp,
        }));
        setMessages(chatMessages);
      }
      setLoading(false);
    };

    fetchChatMessages();

    const channel = supabase
      .channel(`chat_for_case_${caseId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'agent_activities', filter: `case_id=eq.${caseId}` },
        (payload) => {
          const newActivity = payload.new as any;
          if (newActivity.activity_type === "User Prompt" || newActivity.activity_type === "Response") {
            setMessages((prev) => {
              const newMsg: ChatMessage = {
                id: newActivity.id,
                sender: newActivity.activity_type === "User Prompt" ? "user" : "ai",
                content: newActivity.content,
                timestamp: newActivity.timestamp,
              };
              return [...prev, newMsg];
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [caseId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  if (loading) {
    return <div className="text-center py-4 text-muted-foreground">Loading chat history...</div>;
  }

  if (error) {
    return <div className="text-center py-4 text-red-500">{error}</div>;
  }

  return (
    <ScrollArea className="h-[500px] pr-4">
      <div className="flex flex-col space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No messages yet. Send a prompt to start the conversation!
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex items-start gap-3",
                message.sender === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.sender === "ai" && (
                <div className="flex-shrink-0 p-2 rounded-full bg-gray-200 dark:bg-gray-700">
                  <Bot className="h-5 w-5 text-gray-700 dark:text-gray-300" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[70%] p-3 rounded-lg",
                  message.sender === "user"
                    ? "bg-primary text-primary-foreground rounded-br-none"
                    : "bg-muted text-muted-foreground rounded-bl-none"
                )}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className="text-xs opacity-75 mt-1 text-right">
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              {message.sender === "user" && (
                <div className="flex-shrink-0 p-2 rounded-full bg-blue-200 dark:bg-blue-700">
                  <User className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
};