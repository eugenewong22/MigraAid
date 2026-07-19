"use client";

import { useEffect, useRef } from "react";

/**
 * Status line that takes keyboard/screen-reader focus exactly once, when it
 * mounts. Used where a status message replaces the control the user just
 * activated (feedback buttons, delete-my-data), whose removal would otherwise
 * drop focus to the page.
 *
 * Deliberately an effect on mount — NOT an inline `ref={(el) => el?.focus()}`:
 * an inline ref callback has a new identity every render, so React re-attaches
 * (and re-focuses) it on each parent re-render, stealing focus from whatever
 * the user moved on to (e.g. every keystroke in the chat composer).
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
    ref.current?.focus();
  }, []);

  return (
    <p className={className} role="status" tabIndex={-1} ref={ref}>
      {children}
    </p>
  );
}
