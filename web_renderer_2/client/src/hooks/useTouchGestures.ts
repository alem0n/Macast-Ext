import { useEffect, useRef } from 'react';

interface TouchGestureCallbacks {
  onSingleTap: () => void;
  onDoubleTapLeft: (x: number, y: number) => void;
  onDoubleTapRight: (x: number, y: number) => void;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onTouchStart?: () => void;
}

interface UseTouchGesturesOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  callbacks: TouchGestureCallbacks;
}

const TAP_TIMEOUT = 300;
const DOUBLE_TAP_DELAY = 300;
const SWIPE_THRESHOLD = 60;
const TAP_MOVEMENT_THRESHOLD = 10;

export function useTouchGestures({ containerRef, callbacks }: UseTouchGesturesOptions): void {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let lastTapTime = 0;
    let lastTapX = 0;
    let tapTimer: ReturnType<typeof setTimeout>;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      cbRef.current.onTouchStart?.();
    };

    const onTouchEnd = (e: TouchEvent) => {
      // Ignore taps on control buttons / progress bar
      const target = e.target as HTMLElement;
      if (target.closest('.player-controls')) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const dt = Date.now() - startTime;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Horizontal swipe
      if (absDx > SWIPE_THRESHOLD && absDx > absDy * 1.5 && dt < 500) {
        if (dx < 0) {
          cbRef.current.onSwipeLeft();
        } else {
          cbRef.current.onSwipeRight();
        }
        return;
      }

      // Tap — short duration, minimal movement
      if (dt < TAP_TIMEOUT && absDx < TAP_MOVEMENT_THRESHOLD && absDy < TAP_MOVEMENT_THRESHOLD) {
        const now = Date.now();
        const rect = el.getBoundingClientRect();
        const isLeftHalf = (touch.clientX - rect.left) < rect.width / 2;

        if (now - lastTapTime < DOUBLE_TAP_DELAY && Math.abs(touch.clientX - lastTapX) < 40) {
          clearTimeout(tapTimer);
          if (isLeftHalf) {
            cbRef.current.onDoubleTapLeft(touch.clientX, touch.clientY);
          } else {
            cbRef.current.onDoubleTapRight(touch.clientX, touch.clientY);
          }
          lastTapTime = 0;
        } else {
          clearTimeout(tapTimer);
          tapTimer = setTimeout(() => {
            cbRef.current.onSingleTap();
          }, DOUBLE_TAP_DELAY);
          lastTapTime = now;
          lastTapX = touch.clientX;
        }
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      clearTimeout(tapTimer);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [containerRef]);
}
