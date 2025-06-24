import React from "react";
import { AgentActivityCard } from "./AgentActivityCard";

// Mock data to simulate agent interactions
const mockAgentActivities = [
  {
    id: "1",
    agentName: "Fact Extractor",
    agentRole: "Data Analyst Agent",
    activityType: "Analyzing Documents",
    content: "Identified key facts from uploaded documents: Date of marriage, separation date, children's names and ages, primary residence details.",
    timestamp: "2023-10-27 10:00 AM",
    status: "completed" as const,
  },
  {
    id: "2",
    agentName: "Legal Researcher",
    agentRole: "Legal Research Agent",
    activityType: "Researching Relevant Statutes",
    content: "Pulled California Family Code sections related to community property, child custody, and spousal support based on initial facts.",
    timestamp: "2023-10-27 10:05 AM",
    status: "completed" as const,
  },
  {
    id: "3",
    agentName: "Evidence Correlator",
    agentRole: "Evidence Analysis Agent",
    activityType: "Correlating Evidence",
    content: "Cross-referenced bank statements with income declarations. Noted a discrepancy in reported income for Q2 2023.",
    timestamp: "2023-10-27 10:15 AM",
    status: "processing" as const,
  },
  {
    id: "4",
    agentName: "Legal Strategist",
    agentRole: "Case Strategy Agent",
    activityType: "Formulating Initial Arguments",
    content: "Drafting initial arguments for child custody based on 'best interest of the child' principle and identified parental roles.",
    timestamp: "2023-10-27 10:20 AM",
    status: "processing" as const,
  },
  {
    id: "5",
    agentName: "Fact Extractor",
    agentRole: "Data Analyst Agent",
    activityType: "Requesting Clarification",
    content: "Requested clarification on the source of a large deposit in July 2023, marked as 'miscellaneous income'.",
    timestamp: "2023-10-27 10:25 AM",
    status: "processing" as const,
  },
  {
    id: "6",
    agentName: "Legal Strategist",
    agentRole: "Case Strategy Agent",
    activityType: "Identifying Potential Weaknesses",
    content: "Identified potential weakness in spousal support claim due to short marriage duration and both parties having stable employment.",
    timestamp: "2023-10-27 10:30 AM",
    status: "completed" as const,
  },
  {
    id: "7",
    agentName: "Report Generator",
    agentRole: "Output Compilation Agent",
    activityType: "Compiling Interim Report",
    content: "Compiling an interim report on financial discrepancies and initial custody recommendations.",
    timestamp: "2023-10-27 10:35 AM",
    status: "processing" as const,
  },
  {
    id: "8",
    agentName: "Error Handler",
    agentRole: "System Monitoring Agent",
    activityType: "System Alert",
    content: "An error occurred during document parsing for 'Exhibit C - Bank Statements'. Retrying process.",
    timestamp: "2023-10-27 10:40 AM",
    status: "error" as const,
  },
];

export const AgentInteractionDisplay: React.FC = () => {
  return (
    <div className="space-y-4">
      {mockAgentActivities.map((activity) => (
        <AgentActivityCard key={activity.id} {...activity} />
      ))}
    </div>
  );
};