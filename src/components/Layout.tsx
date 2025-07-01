import React from "react";
import { Sidebar } from "./Sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PanelLeft, Scale } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const isMobile = useIsMobile();

  if (isMobile) {
    // Mobile layout with a sheet for the sidebar
    return (
      <div className="flex min-h-screen w-full flex-col bg-muted/40">
        <header className="sticky top-0 flex h-14 items-center gap-4 border-b bg-background px-4 sm:h-[60px] sm:px-6 z-10">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0">
                <PanelLeft className="h-5 w-5" />
                <span className="sr-only">Toggle navigation menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Scale className="h-6 w-6 text-primary" />
            <span className="">Family Law AI</span>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    );
  }

  // Desktop layout with a fixed sidebar
  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-background md:block">
        <Sidebar />
      </div>
      <div className="flex flex-col h-screen overflow-hidden">
        <main className="flex-1 h-full overflow-y-auto bg-muted/40">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Layout;