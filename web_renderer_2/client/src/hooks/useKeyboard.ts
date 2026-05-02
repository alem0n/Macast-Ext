import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../store';
import { togglePlay, seek, setFullscreen } from '../store/playerSlice';

interface UseKeyboardOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function useKeyboard({ videoRef, containerRef }: UseKeyboardOptions): void {
  const dispatch = useDispatch();
  const media = useSelector((s: RootState) => s.player.media);
  const currentTime = useSelector((s: RootState) => s.player.currentTime);
  const duration = useSelector((s: RootState) => s.player.duration);
  const status = useSelector((s: RootState) => s.player.status);
  const isFullscreen = useSelector((s: RootState) => s.player.isFullscreen);

  useEffect(() => {
    if (!media) return;

    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case ' ': {
          e.preventDefault();
          const video = videoRef.current;
          if (!video) break;

          if (status === 'playing') {
            video.pause();
          } else if (status === 'paused') {
            video.play().catch(() => {});
          }
          dispatch(togglePlay());
          break;
        }

        case 'ArrowLeft': {
          e.preventDefault();
          const video = videoRef.current;
          if (!video) break;
          const t = Math.max(0, currentTime - 5);
          video.currentTime = t;
          dispatch(seek(t));
          break;
        }

        case 'ArrowRight': {
          e.preventDefault();
          const video = videoRef.current;
          if (!video) break;
          const t = Math.min(duration, currentTime + 5);
          video.currentTime = t;
          dispatch(seek(t));
          break;
        }

        case 'f':
        case 'F':
        case 'F11': {
          e.preventDefault();
          const el = containerRef.current;
          if (!el) break;

          if (!isFullscreen) {
            if (el.requestFullscreen) {
              el.requestFullscreen();
            } else if ((el as any).webkitRequestFullscreen) {
              (el as any).webkitRequestFullscreen();
            }
            dispatch(setFullscreen(true));
          } else {
            if (document.exitFullscreen) {
              document.exitFullscreen();
            } else if ((document as any).webkitExitFullscreen) {
              (document as any).webkitExitFullscreen();
            }
            dispatch(setFullscreen(false));
          }
          break;
        }

        case 'Escape': {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            (document as any).webkitExitFullscreen();
          }
          dispatch(setFullscreen(false));
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dispatch, media, currentTime, duration, status, isFullscreen, videoRef, containerRef]);
}
