import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface DemoModeContextValue {
  isDemo: boolean;
  toggleDemo: () => void;
  setDemo: (v: boolean) => void;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  isDemo: false,
  toggleDemo: () => {},
  setDemo: () => {},
});

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const [isDemo, setIsDemo] = useState<boolean>(() => {
    try {
      return localStorage.getItem("tradeflow_demo_mode") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("tradeflow_demo_mode", isDemo ? "true" : "false");
    } catch {}
  }, [isDemo]);

  const toggleDemo = () => setIsDemo((v) => !v);
  const setDemo = (v: boolean) => setIsDemo(v);

  return (
    <DemoModeContext.Provider value={{ isDemo, toggleDemo, setDemo }}>
      {children}
    </DemoModeContext.Provider>
  );
}

export function useDemoMode() {
  return useContext(DemoModeContext);
}
