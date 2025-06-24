import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AgentActivityCardProps {
  agentName: string;
  agentRole: string;
  activityType: string;
  content: string;
  timestamp: string;
  status: "processing" | "completed" | "error";
}

const getStatusBadgeVariant = (status: AgentActivityCardProps["status"]) => {
  switch (status) {
    case "processing":
      return "secondary";
    case "completed":
      return "default";
    case "error":
      return "destructive";
    default:
      return "outline";
  }
};

export const AgentActivityCard: React.FC<AgentActivityCardProps> = ({
  agentName,
  agentRole,
  activityType,
  content,
  timestamp,
  status,
}) => {
  const getInitials = (name: string) => {
    return name.split(" ").map(n => n[0]).join("").toUpperCase();
  };

  return (
    <Card className={cn("mb-4", status === "error" && "border-destructive")}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center space-x-3">
          <Avatar>
            <AvatarFallback>{getInitials(agentName)}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-lg">{agentName}</CardTitle>
            <p className="text-sm text-muted-foreground">{agentRole}</p>
          </div>
        </div>
        <Badge variant={getStatusBadgeVariant(status)}>{status}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm font-semibold mb-2">{activityType}</p>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{content}</p>
        <p className="text-xs text-muted-foreground mt-2 text-right">{timestamp}</p>
      </CardContent>
    </Card>
  );
};