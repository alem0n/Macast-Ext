import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../store';
import { togglePlay, seek } from '../../store/playerSlice';
import { useVideoEvents } from '../../hooks/useVideoEvents';
import { usePlaylistNavigation } from '../../hooks/usePlaylistNavigation';
import { useKeyboard } from '../../hooks/useKeyboard';
import { useTouchGestures } from '../../hooks/useTouchGestures';
import PlayerControls from './PlayerControls';
import StatusOverlay from '../StatusOverlay';
import Toast from '../Toast';

const CONTROLS_HIDE_DELAY = 3000;
const SEEK_STEP = 10;

const VideoPlayer: React.FC = () => {
  const dispatch = useDispatch();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const media = useSelector((s: RootState) => s.player.media);
  const status = useSelector((s: RootState) => s.player.status);
  const isFullscreen = useSelector((s: RootState) => s.player.isFullscreen);
  const currentTime = useSelector((s: RootState) => s.player.currentTime);
  const duration = useSelector((s: RootState) => s.player.duration);

  const { goNext, goPrev, navLoading } = usePlaylistNavigation();
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [seekHint, setSeekHint] = useState<{
    side: 'left' | 'right';
    x: number;
    y: number;
  } | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    setToastVisible(true);
  }, []);

  const hideToast = useCallback(() => {
    setToastVisible(false);
  }, []);

  const handleEnded = useCallback(async () => {
    const success = await goNext();
    if (!success) {
      showToast('已到达最后一个视频');
    }
  }, [goNext, showToast]);

  const { isDraggingRef } = useVideoEvents(videoRef, handleEnded);
  useKeyboard({ videoRef, containerRef });

  // ── Touch gesture callbacks ──────────────────────────────────────

  const handleSingleTap = useCallback(() => {
    const video = videoRef.current;
    if (!video || !media) return;

    if (status === 'playing') {
      video.pause();
    } else if (status === 'paused') {
      video.play().catch(() => {});
    }
    dispatch(togglePlay());
  }, [dispatch, status, videoRef, media]);

  const handleDoubleTapLeft = useCallback((x: number, y: number) => {
    const video = videoRef.current;
    if (!video || !media) return;
    const t = Math.max(0, currentTime - SEEK_STEP);
    video.currentTime = t;
    dispatch(seek(t));
    setSeekHint({ side: 'left', x, y });
    setTimeout(() => setSeekHint(null), 600);
  }, [dispatch, currentTime, videoRef, media]);

  const handleDoubleTapRight = useCallback((x: number, y: number) => {
    const video = videoRef.current;
    if (!video || !media) return;
    const t = Math.min(duration || Infinity, currentTime + SEEK_STEP);
    video.currentTime = t;
    dispatch(seek(t));
    setSeekHint({ side: 'right', x, y });
    setTimeout(() => setSeekHint(null), 600);
  }, [dispatch, currentTime, duration, videoRef, media]);

  const handleSwipeLeft = useCallback(async () => {
    if (navLoading) return;
    const success = await goNext();
    if (!success) {
      showToast('已到达最后一个视频');
    }
  }, [goNext, navLoading, showToast]);

  const handleSwipeRight = useCallback(async () => {
    if (navLoading) return;
    await goPrev();
  }, [goPrev, navLoading]);

  // Trigger controls visibility on any touch
  const handleTouchStart = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, []);

  useTouchGestures({
    containerRef,
    callbacks: {
      onSingleTap: handleSingleTap,
      onDoubleTapLeft: handleDoubleTapLeft,
      onDoubleTapRight: handleDoubleTapRight,
      onSwipeLeft: handleSwipeLeft,
      onSwipeRight: handleSwipeRight,
      onTouchStart: handleTouchStart,
    },
  });

  // ── Mouse-based controls visibility ──────────────────────────────

  const showControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hideTimerRef.current);
  }, []);

  // Load and play when media URL changes (video remount via key)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !media?.url) return;

    console.log(`[VideoPlayer] loading src=${media.url.substring(0, 80)} title="${media.title}"`);
    video.load();
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        console.log('[VideoPlayer] direct play() blocked — waiting for user gesture');
      });
    }
  }, [media?.url]);

  // Disable context menu on fullscreen video
  useEffect(() => {
    const onContextMenu = (e: Event) => {
      if (isFullscreen) {
        e.preventDefault();
      }
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [isFullscreen]);

  const showControlsBar = controlsVisible && (status === 'playing' || status === 'paused');

  const videoKey = media?.url || 'empty';

  return (
    <div
      className={`player-container ${isFullscreen ? 'player-fullscreen' : ''}`}
      ref={containerRef}
      onMouseMove={showControls}
      onMouseLeave={() => setControlsVisible(false)}
    >
      <video
        key={videoKey}
        ref={videoRef}
        className="player-video"
        src={media?.url || ''}
        preload="auto"
        autoPlay
        controls={false}
        playsInline
        onContextMenu={(e) => e.preventDefault()}
      />

      <StatusOverlay videoRef={videoRef} />

      {media && (
        <PlayerControls
          videoRef={videoRef}
          containerRef={containerRef}
          isDraggingRef={isDraggingRef}
          visible={showControlsBar}
        />
      )}

      <Toast
        message={toastMessage}
        visible={toastVisible}
        onClose={hideToast}
      />

      {seekHint && (
        <div
          className={`seek-hint seek-hint-${seekHint.side}`}
          style={{ left: seekHint.x, top: seekHint.y }}
        >
          <span className="seek-hint-icon">{seekHint.side === 'left' ? '◀' : '▶'}</span>
          <span>{SEEK_STEP}s</span>
        </div>
      )}
    </div>
  );
};

export default VideoPlayer;
