import React, { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Bot, User, Search } from "lucide-react"; // Import Search icon

interface ChatMessage {
  id: string;
  sender: "user" | "ai" | "system"; // Added 'system' for web search results
  content: string;
  timestamp: string;
  activityType?: string; // To differentiate between AI response and web search results
  rawContent?: any; // To store raw JSON for web search results
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

  // Helper to format web search results
  const formatWebSearchResults = (results: any[]) => {
    if (!results || results.length === 0) {
      return "No web search results found.";
    }
    return results.map((item, index) => (
      `\n${index + 1}. ${item.title}\n   Link: ${item.link}\n   Snippet: ${item.snippet}`
    )).join('\n');
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
        .in("activity_type", ["User Prompt", "Response", "Web Search Completed"]) // Include Web Search Completed
        .order("timestamp", { ascending: true });

      if (error) {
        console.error("Error fetching chat messages:", error);
        setError("Failed to load chat messages. Please try again.");
        toast.error("Failed to load chat messages.");
      } else {
        const chatMessages: ChatMessage[] = (data || []).map((activity) => {
          let sender: ChatMessage['sender'] = "ai";
          let content = activity.content;
          let rawContent = null;

          if (activity.activity_type === "User Prompt") {
            sender = "user";
          } else if (activity.activity_type === "Web Search Completed") {
            sender = "system";
            try {
              rawContent = JSON.parse(activity.content);
              content = `Web Search Results:\n${formatWebSearchResults(rawContent)}`;
            } catch (e) {
              console.error("Failed to parse web search content:", e);
              content = `Web Search Results (Error parsing content):\n${activity.content}`;
            }
          }
          
          return {
            id: activity.id,
            sender: sender,
            content: content,
            timestamp: activity.timestamp,
            activityType: activity.activity_type,
            rawContent: rawContent,
          };
        });
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
          if (newActivity.activity_type === "User Prompt" || newActivity.activity_type === "Response" || newActivity.activity_type === "Web Search Completed") {
            setMessages((prev) => {
              let sender: ChatMessage['sender'] = "ai";
              let content = newActivity.content;
              let rawContent = null;

              if (newActivity.activity_type === "User Prompt") {
                sender = "user";
              } else if (newActivity.activity_type === "Web Search Completed") {
                sender = "system";
                try {
                  rawContent = JSON.parse(newActivity.content);
                  content = `Web Search Results:\n${formatWebSearchResults(rawContent)}`;
                } catch (e) {
                  console.error("Failed to parse web search content:", e);
                  content = `Web Search Results (Error parsing content):\n${newActivity.content}`;
                }
              }

              const newMsg: ChatMessage = {
                id: newActivity.id,
                sender: sender,
                content: content,
                timestamp: newActivity.timestamp,
                activityType: newActivity.activity_type,
                rawContent: rawContent,
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
              {message.sender === "system" && (
                <div className="flex-shrink-0 p-2 rounded-full bg-purple-200 dark:bg-purple-700">
                  <Search className="h-5 w-5 text-purple-700 dark:text-purple-300" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[70%] p-3 rounded-lg",
                  message.sender === "user"
                    ? "bg-primary text-primary-foreground rounded-br-none"
                    : message.sender === "system"
                      ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded-bl-none"
                      : "bg-muted text-muted-foreground rounded-bl-none"
                )}
              >
                {message.activityType === "Web Search Completed" ? (
                  <>
                    <p className="font-semibold mb-1">Web Search Results:</p>
                    {message.rawContent && message.rawContent.length > 0 ? (
                      <ul className="list-disc list-inside space-y-2">
                        {message.rawContent.map((item: any, idx: number) => (
                          <li key={idx}>
                            <p className="font-medium">{item.title}</p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">{item.snippet}</p>
                            <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
                              {item.link}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm">No relevant results found for this query.</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                )}
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