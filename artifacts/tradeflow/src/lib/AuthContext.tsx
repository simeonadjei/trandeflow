import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  isAdmin: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  token: null,
  login: () => {},
  logout: () => {},
  isAdmin: false,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const s = localStorage.getItem("tf_user");
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  });
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem("tf_token"); } catch { return null; }
  });

  const login = (t: string, u: AuthUser) => {
    setToken(t);
    setUser(u);
    localStorage.setItem("tf_token", t);
    localStorage.setItem("tf_user", JSON.stringify(u));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("tf_token");
    localStorage.removeItem("tf_user");
  };

  return (
    <AuthContext.Provider value={{
      user, token,
      login, logout,
      isAdmin: user?.role === "admin",
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
