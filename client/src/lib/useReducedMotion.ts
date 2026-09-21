import { useEffect, useState } from "react";

/** Mirrors `prefers-reduced-motion` for the JS-driven bits CSS alone can't
 *  stop (smooth scroll, funnel bar mount animation gating, etc). The global
 *  CSS override in styles.css handles every pure-CSS transition/animation
 *  already; this is only for call sites that branch in JS. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
