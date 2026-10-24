"use client";

import JSZip from "jszip";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  processWatchFiles,
  type LocalVideoEntry,
  type VideoEntry,
  type YouTubeVideoEntry,
} from "@/lib/groupwatch-import";
import type { YouTubePlayer } from "@/types/youtube";

export default function WatchPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const archivesRef = useRef<Record<string, JSZip>>({});
  const videoEntriesRef = useRef<VideoEntry[]>([]);
  const playRandomVideoWithDelayRef = useRef<() => void>(() => {});
  const youtubeContainerRef = useRef<HTMLDivElement>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const pendingEntryRef = useRef<VideoEntry | null>(null);
  const pendingPreloadPromiseRef = useRef<Promise<boolean> | null>(null);
  const pendingLocalVideoUrlRef = useRef<string>("");
  const resolveYouTubeReadyRef = useRef<((ready: boolean) => void) | null>(null);
  const currentVideoUrlRef = useRef<string>("");
  const nextDelayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [videoEntries, setVideoEntries] = useState<VideoEntry[]>([]);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string>("");
  const [currentYouTubeClip, setCurrentYouTubeClip] = useState<YouTubeVideoEntry | null>(null);
  const [isPlaybackVisible, setIsPlaybackVisible] = useState(true);
  const [isYouTubeApiReady, setIsYouTubeApiReady] = useState(false);
  const [loadingArchive, setLoadingArchive] = useState(false);
  const [loadingVideo, setLoadingVideo] = useState(false);
  const [isNextDelayActive, setIsNextDelayActive] = useState(false);
  const [nextDelayProgress, setNextDelayProgress] = useState(0);

  useEffect(() => {
    videoEntriesRef.current = videoEntries;
  }, [videoEntries]);

  const clearNextDelayTimer = () => {
    if (nextDelayTimerRef.current) {
      clearInterval(nextDelayTimerRef.current);
      nextDelayTimerRef.current = null;
    }
  };

  const revokeCurrentVideoUrl = () => {
    if (currentVideoUrlRef.current) {
      URL.revokeObjectURL(currentVideoUrlRef.current);
      currentVideoUrlRef.current = "";
    }
  };

  const revokePendingLocalVideoUrl = () => {
    if (pendingLocalVideoUrlRef.current) {
      URL.revokeObjectURL(pendingLocalVideoUrlRef.current);
      pendingLocalVideoUrlRef.current = "";
    }
  };

  const destroyYouTubePlayer = () => {
    if (youtubePlayerRef.current) {
      youtubePlayerRef.current.destroy();
      youtubePlayerRef.current = null;
    }
  };

  const clearCurrentPlayback = () => {
    revokeCurrentVideoUrl();
    destroyYouTubePlayer();
    setCurrentVideoUrl("");
    setCurrentYouTubeClip(null);
    setIsPlaybackVisible(false);
  };

  const preloadLocalVideo = async (entry: LocalVideoEntry) => {
    const zipFile = archivesRef.current[entry.archiveId]?.file(entry.name);

    if (!zipFile) {
      return false;
    }

    setLoadingVideo(true);

    try {
      const blob = await zipFile.async("blob");
      revokePendingLocalVideoUrl();
      pendingLocalVideoUrlRef.current = URL.createObjectURL(blob);
      return true;
    } catch {
      // Ignore load failures to keep playback flow minimal.
      return false;
    } finally {
      setLoadingVideo(false);
    }
  };

  const setYouTubeVideo = (entry: YouTubeVideoEntry) => {
    setCurrentYouTubeClip({
      kind: "youtube",
      id: entry.id,
      start: Math.max(0, Math.floor(entry.start)),
      end: Math.max(Math.floor(entry.start) + 1, Math.floor(entry.end)),
    });

    return new Promise<boolean>((resolve) => {
      resolveYouTubeReadyRef.current = resolve;
    });
  };

  const revealAndPlayPendingEntry = async (selectedEntry: VideoEntry) => {
    if (selectedEntry.kind === "local") {
      if (!pendingLocalVideoUrlRef.current) {
        return false;
      }

      revokeCurrentVideoUrl();
      currentVideoUrlRef.current = pendingLocalVideoUrlRef.current;
      pendingLocalVideoUrlRef.current = "";
      destroyYouTubePlayer();
      setCurrentYouTubeClip(null);
      setCurrentVideoUrl(currentVideoUrlRef.current);
      setIsPlaybackVisible(true);
      return true;
    }

    revokeCurrentVideoUrl();
    setCurrentVideoUrl("");
    setIsPlaybackVisible(true);
    youtubePlayerRef.current?.unMute();
    youtubePlayerRef.current?.playVideo();
    return true;
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleArchiveUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    setLoadingArchive(true);
    try {
      const processed = await processWatchFiles(files);

      if (processed.entries.length > 0) {
        Object.assign(archivesRef.current, processed.archives);
        setVideoEntries((previous) => [...previous, ...processed.entries]);
      }
    } catch {
      // Ignore invalid archives to keep the UI minimal.
    } finally {
      setLoadingArchive(false);
      event.target.value = "";
    }
  };

  const playRandomVideoWithDelay = () => {
    const queue = videoEntriesRef.current;

    if (queue.length === 0 || loadingArchive || loadingVideo || isNextDelayActive) {
      return;
    }

    const randomIndex = Math.floor(Math.random() * queue.length);
    const selectedEntry = queue[randomIndex];

    clearCurrentPlayback();
    setIsPlaybackVisible(false);
    pendingEntryRef.current = selectedEntry;

    if (selectedEntry.kind === "local") {
      pendingPreloadPromiseRef.current = preloadLocalVideo(selectedEntry);
    } else {
      pendingPreloadPromiseRef.current = setYouTubeVideo(selectedEntry);
    }

    clearNextDelayTimer();
    setIsNextDelayActive(true);
    setNextDelayProgress(0);

    const delayMs = 3000;
    const startedAt = Date.now();

    nextDelayTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(100, (elapsed / delayMs) * 100);

      setNextDelayProgress(progress);

      if (progress >= 100) {
        clearNextDelayTimer();
        setIsNextDelayActive(false);
        setNextDelayProgress(0);

        void (async () => {
          const loaded = (await pendingPreloadPromiseRef.current) ?? false;

          if (!loaded || !pendingEntryRef.current) {
            pendingEntryRef.current = null;
            pendingPreloadPromiseRef.current = null;
            return;
          }

          const activeEntry = pendingEntryRef.current;
          const revealed = await revealAndPlayPendingEntry(activeEntry);

          if (revealed) {
            setVideoEntries((previous) => {
              const nextIndex = previous.findIndex((entry) => {
                if (entry.kind !== activeEntry.kind) {
                  return false;
                }

                if (entry.kind === "local" && activeEntry.kind === "local") {
                  return entry.archiveId === activeEntry.archiveId && entry.name === activeEntry.name;
                }

                if (entry.kind === "youtube" && activeEntry.kind === "youtube") {
                  return (
                    entry.id === activeEntry.id &&
                    entry.start === activeEntry.start &&
                    entry.end === activeEntry.end
                  );
                }

                return false;
              });

              if (nextIndex === -1) {
                return previous;
              }

              const next = [...previous];
              next.splice(nextIndex, 1);
              return next;
            });
          }

          pendingEntryRef.current = null;
          pendingPreloadPromiseRef.current = null;
        })();
      }
    }, 30);
  };

  playRandomVideoWithDelayRef.current = playRandomVideoWithDelay;

  const handleVideoEnded = () => {
    clearCurrentPlayback();
  };

  useEffect(() => {
    if (window.YT?.Player) {
      setIsYouTubeApiReady(true);
      return undefined;
    }

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');

    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.body.appendChild(script);
    }

    const previousHandler = window.onYouTubeIframeAPIReady;

    window.onYouTubeIframeAPIReady = () => {
      setIsYouTubeApiReady(true);
      if (previousHandler) {
        previousHandler();
      }
    };

    return () => {
      window.onYouTubeIframeAPIReady = previousHandler;
    };
  }, []);

  useEffect(() => {
    if (!currentYouTubeClip || !isYouTubeApiReady || !youtubeContainerRef.current || !window.YT?.Player) {
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
      return undefined;
    }

    if (youtubePlayerRef.current) {
      youtubePlayerRef.current.destroy();
      youtubePlayerRef.current = null;
    }

    const player = new window.YT.Player(youtubeContainerRef.current, {
      height: "100%",
      width: "100%",
      videoId: currentYouTubeClip.id,
      playerVars: {
        autoplay: 0,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        start: currentYouTubeClip.start,
        end: currentYouTubeClip.end,
      },
      events: {
        onReady: (event) => {
          // Warm up buffering while hidden during the countdown.
          event.target.mute();
          event.target.playVideo();
          window.setTimeout(() => {
            event.target.pauseVideo();
            event.target.seekTo(currentYouTubeClip.start, true);
          }, 250);

          if (resolveYouTubeReadyRef.current) {
            resolveYouTubeReadyRef.current(true);
            resolveYouTubeReadyRef.current = null;
          }
        },
        onStateChange: (event) => {
          if (event.data === window.YT?.PlayerState.ENDED) {
            revokeCurrentVideoUrl();
            if (youtubePlayerRef.current) {
              youtubePlayerRef.current.destroy();
              youtubePlayerRef.current = null;
            }
            setCurrentVideoUrl("");
            setCurrentYouTubeClip(null);
            setIsPlaybackVisible(false);
          }
        },
      },
    });

    youtubePlayerRef.current = player;

    return () => {
      player.destroy();
      if (youtubePlayerRef.current === player) {
        youtubePlayerRef.current = null;
      }
    };
  }, [currentYouTubeClip, isYouTubeApiReady]);

  useEffect(() => {
    return () => {
      clearNextDelayTimer();
      revokeCurrentVideoUrl();
      revokePendingLocalVideoUrl();
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
      setCurrentVideoUrl("");
      setCurrentYouTubeClip(null);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "n" && event.key !== "N") {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      playRandomVideoWithDelayRef.current();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden text-gray-100">
      <section className="relative flex flex-[4] overflow-hidden bg-black">
        {currentVideoUrl && isPlaybackVisible ? (
          <video
            key={currentVideoUrl}
            src={currentVideoUrl}
            controls
            autoPlay
            playsInline
            onEnded={handleVideoEnded}
            className="h-full w-full object-contain bg-black"
          />
        ) : currentYouTubeClip ? (
          <div ref={youtubeContainerRef} className="h-full w-full bg-black" />
        ) : null}

        {!isPlaybackVisible ? <div className="absolute inset-0 bg-black" /> : null}
      </section>

      <footer className="flex items-center justify-center gap-4 border-t border-white/10 p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".groupwatch,.json"
          multiple
          onChange={handleArchiveUpload}
          className="hidden"
        />

        <button
          type="button"
          onClick={openFilePicker}
          className="gw-btn px-6 py-3"
          disabled={loadingArchive || loadingVideo}
        >
          Add to Queue
        </button>

        <button
          type="button"
          onClick={playRandomVideoWithDelay}
          className="gw-btn relative overflow-hidden px-6 py-3"
          disabled={videoEntries.length === 0 || loadingArchive || loadingVideo}
        >
          <span
            className="absolute inset-y-0 left-0 bg-sky-200/20"
            style={{ width: `${nextDelayProgress}%` }}
          />
          <span className="relative z-10">Next Video</span>
        </button>

        <p className="text-sm text-gray-300">
          {videoEntries.length} video{videoEntries.length === 1 ? "" : "s"} queued
        </p>
      </footer>

    </main>
  );
}
