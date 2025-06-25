import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import MyCases from "./pages/MyCases";
import AgentInteraction from "./pages/AgentInteraction";
import AiProfileSettings from "./pages/AiProfileSettings";
import CaseDetails from "./pages/CaseDetails";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { ThemeProvider } from "next-themes";
import { SessionContextProvider } from "@/components/SessionContextProvider";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <SessionContextProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/my-cases" element={<MyCases />} />
              <Route path="/agent-interaction/:caseId" element={<AgentInteraction />} />
              <Route path="/case-details/:caseId" element={<CaseDetails />} />
              <Route path="/ai-settings" element={<AiProfileSettings />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </SessionContextProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;