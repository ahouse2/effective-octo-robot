import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TimelineDisplay } from './TimelineDisplay';
import { GraphDisplay } from './GraphDisplay';

interface VisualizationsTabProps {
  caseId: string;
}

export const VisualizationsTab: React.FC<VisualizationsTabProps> = ({ caseId }) => {
  return (
    <Tabs defaultValue="timeline" className="h-full flex flex-col">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="graph">Knowledge Graph</TabsTrigger>
      </TabsList>
      <TabsContent value="timeline" className="flex-1 overflow-hidden pt-4">
        <TimelineDisplay caseId={caseId} />
      </TabsContent>
      <TabsContent value="graph" className="flex-1 overflow-hidden pt-4">
        <GraphDisplay caseId={caseId} />
      </TabsContent>
    </Tabs>
  );
};