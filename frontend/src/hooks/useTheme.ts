import { useCallback, useEffect } from "react";
import { useUserPrefsStore, THEME_MODE, type ThemeMode } from "@/stores/userPrefsStore";

function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return THEME_MODE.LIGHT;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? THEME_MODE.DARK
    : THEME_MODE.LIGHT;
}

export function useTheme() {
  const storedMode = useUserPrefsStore((state) => state.theme.mode);
  const setTheme = useUserPrefsStore((state) => state.setTheme);
  const theme: ThemeMode = storedMode ?? getSystemTheme();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (useUserPrefsStore.getState().theme.mode === null) {
        document.documentElement.setAttribute(
          "data-theme",
          mq.matches ? THEME_MODE.DARK : THEME_MODE.LIGHT
        );
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const toggleTheme = useCallback(() => {
    const current = useUserPrefsStore.getState().theme.mode ?? getSystemTheme();
    setTheme(current === THEME_MODE.LIGHT ? THEME_MODE.DARK : THEME_MODE.LIGHT);
  }, [setTheme]);

  return { theme, toggleTheme };
}
