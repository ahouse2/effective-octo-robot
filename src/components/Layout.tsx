import React from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { Sidebar } from "./Sidebar";
import { useIsMobile } from "@/hooks/use-mobile";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const isMobile = useIsMobile();

  return (
    <div className="flex h-screen w-full">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={isMobile ? 0 : 20} minSize={isMobile ? 0 : 15} maxSize={isMobile ? 0 : 25} collapsible={true} collapsedSize={0}>
          <Sidebar />
        </ResizablePanel>
        {!isMobile && <ResizableHandle withHandle />}
        <ResizablePanel defaultSize={isMobile ? 100 : 80}>
          <div className="flex flex-col h-full">
            <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8">
              {children}
            </main>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default Layout;