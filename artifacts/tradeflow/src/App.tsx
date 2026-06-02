import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DemoModeProvider } from "@/lib/DemoModeContext";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Trade from "@/pages/Trade";
import Wallet from "@/pages/Wallet";
import Learn from "@/pages/Learn";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 10000 },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/trade" component={Trade} />
      <Route path="/wallet" component={Wallet} />
      <Route path="/learn" component={Learn} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DemoModeProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </DemoModeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
