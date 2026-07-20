"use client";

import { useEffect, useRef } from "react";

/**
 * Status line that takes keyboard/screen-reader focus when it mounts — but ONLY
 * if focus would otherwise be lost. Used where a status message replaces the
 * control the user just activated (feedback buttons, delete-my-data), whose
 * removal drops focus to the page.
 *
 * Two failure modes this avoids:
 *  - An inline `ref={(el) => el?.focus()}` re-focuses on every parent re-render
 *    (new callback identity each time), so it is an effect that runs once.
 *  - The mount here is triggered by an ASYNC fetch resolving, not by the user's
 *    activation. If the user has already moved on (e.g. tapped the composer and
 *    started typing while a slow feedback POST was in flight), grabbing focus
 *    would yank it out of the input mid-word. So we only claim focus when it is
 *    still on <body> (i.e. the removed control dropped it), never when the user
 *    has focused something else.
 */
export function StatusFocus({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) ref.current?.focus();
  }, []);

  return (
    <p className={className} role="status" tabIndex={-1} ref={ref}>
      {children}
    </p>
  );
}
