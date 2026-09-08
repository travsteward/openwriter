import { useCallback, useRef, useState } from 'react';

// adr: adr/responsive-overlay-layout.md
export function useFocusMode({ sidebarOpen, showToolbar, setSidebarOpen, setSidebarDrawer, setShowToolbar }: {
  sidebarOpen: boolean;
  showToolbar: boolean;
  setSidebarOpen: (value: boolean) => void;
  setSidebarDrawer: (value: boolean) => void;
  setShowToolbar: (value: boolean) => void;
}) {
  const [focusMode, setFocusMode] = useState(false);
  const focusSnapshotRef = useRef<{ sidebarOpen: boolean; showToolbar: boolean } | null>(null);
  const toggleFocusMode = useCallback(() => {
    setFocusMode((cur) => {
      if (!cur) {
        // Entering focus mode — snapshot sidebar + toolbar, close both.
        // Snapshot/restore is intent-only; the transient overlay drawer is
        // closed outright (it has no place in focus mode and isn't restored).
        focusSnapshotRef.current = { sidebarOpen, showToolbar };
        setSidebarOpen(false);
        setSidebarDrawer(false);
        setShowToolbar(false);
        return true;
      }
      // Exiting — restore snapshot if we have one.
      const snap = focusSnapshotRef.current;
      if (snap) {
        setSidebarOpen(snap.sidebarOpen);
        setShowToolbar(snap.showToolbar);
        focusSnapshotRef.current = null;
      }
      return false;
    });
  }, [sidebarOpen, showToolbar]);


  return { focusMode, toggleFocusMode };
}
