import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import EvidenceAnalysis from "./pages/EvidenceAnalysis";
import CaseManagement from "./pages/CaseManagement";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login"; // Import the new Login page
import { ThemeProvider } from "next-themes";
import { SessionContextProvider } from "@/components/SessionContextProvider"; // Import SessionContextProvider

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <SessionContextProvider> {/* Wrap the entire app with SessionContextProvider */}
            <Routes>
              <Route path="/login" element={<Login />} /> {/* Add the Login route */}
              <Route path="/" element={<Index />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/evidence-analysis" element={<EvidenceAnalysis />} />
              <Route path="/case-management" element={<CaseManagement />} />
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