"use client";

import { useEffect } from "react";

/**
 * Brings the item opened from an ID chip (/backlog?element=US-001) into view, once the router has
 * done its own scroll of the new page (which would otherwise undo this one).
 */
export function ScrollToElement({ id }: { id: string }) {
  useEffect(() => {
    const timer = setTimeout(
      () => document.getElementById(id)?.scrollIntoView({ block: "center" }),
      150,
    );
    return () => clearTimeout(timer);
  }, [id]);
  return null;
}
