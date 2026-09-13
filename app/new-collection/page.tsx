"use client";

import JSZip from "jszip";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ChangeEvent, MouseEvent, useEffect, useRef, useState } from "react";
import type { YouTubePlayer } from "@/types/youtube";
import youtubeLogo from "@/assets/img/youtube logo.svg";
import uploadIcon from "@/assets/icon/up-loading.png";

type SelectedVideo = {
  kind: "local";
  id: string;
  name: string;
  sizeMB: string;
  durationSeconds: number | null;
  sizeBytes: number;
  mimeType: string;
  lastModified: number;
  url: string;
};

type YouTubeClip = {
  kind: "youtube";
  id: string;
  name: string;
  videoId: string;
  sourceUrl: string;
  start: number;
  end: number;
};

type QueueItem = SelectedVideo | YouTubeClip;

function createQueueItemId() {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isSameQueueItem(left: QueueItem | null, right: QueueItem) {
  return left !== null && left.id === right.id;
}

function formatVideoName(name: string, maxChars = 40) {
  if (name.length <= maxChars) {
    return name;
  }

  const extensionStart = name.lastIndexOf(".");
  const hasExtension = extensionStart > 0 && extensionStart < name.length - 1;

  if (!hasExtension) {
    return `${name.slice(0, maxChars)}...`;
  }

  const baseName = name.slice(0, extensionStart);
  const extension = name.slice(extensionStart);
  const visibleBaseChars = Math.max(1, maxChars - extension.length - 3);

  return `${baseName.slice(0, visibleBaseChars)}...${extension}`;
}

function formatDuration(durationSeconds: number | null) {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) {
    return "?:??";
  }

  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function parseYouTubeVideoId(input: string) {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    return "";
  }

  try {
    const url = new URL(trimmedInput.startsWith("http") ? trimmedInput : `https://${trimmedInput}`);
    const searchId = url.searchParams.get("v");

    if (searchId) {
      return searchId;
    }

    const pathSegments = url.pathname.split("/").filter(Boolean);

    if (url.hostname.includes("youtu.be") && pathSegments.length > 0) {
      return pathSegments[0];
    }

    if (url.hostname.includes("youtube.com") || url.hostname.includes("music.youtube.com")) {
      if (pathSegments[0] === "shorts" || pathSegments[0] === "embed" || pathSegments[0] === "watch") {
        return pathSegments[1] ?? "";
      }
    }

    return pathSegments[0] ?? "";
  } catch {
    return trimmedInput.length >= 6 ? trimmedInput : "";
  }
}

function getVideoDurationSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const probeUrl = URL.createObjectURL(file);
    const video = document.createElement("video");

    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(probeUrl);
    };

    video.preload = "metadata";
    video.src = probeUrl;

    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      cleanup();
      resolve(duration);
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}

export default function PlaylistCreatorPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const allObjectUrlsRef = useRef<string[]>([]);
  const selectedClipElementRef = useRef<HTMLDivElement | null>(null);
  const [clipQueue, setClipQueue] = useState<QueueItem[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<QueueItem | null>(null);
  const [uploadError, setUploadError] = useState<string>("");
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportError, setExportError] = useState<string>("");
  const [isAddClipModalOpen, setIsAddClipModalOpen] = useState(false);
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("New GroupWatch Collection");
  const [youtubeLink, setYoutubeLink] = useState("");
  const [youtubeLinkError, setYoutubeLinkError] = useState("");
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const [cropClipIndex, setCropClipIndex] = useState<number | null>(null);
  const [cropStartInput, setCropStartInput] = useState("0");
  const [cropEndInput, setCropEndInput] = useState("");
  const [cropRangeError, setCropRangeError] = useState("");
  const cropPlayerRef = useRef<YouTubePlayer | null>(null);
  const [deleteClipIndex, setDeleteClipIndex] = useState<number | null>(null);

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const openCropModal = (index: number) => {
    const clip = clipQueue[index];

    if (!clip || clip.kind !== "youtube") {
      return;
    }

    setCropClipIndex(index);
    setCropStartInput(String(clip.start ?? 0));
    setCropEndInput(clip.end && clip.end !== 86400 ? String(clip.end) : "");
    setCropRangeError("");
    setIsCropModalOpen(true);
  };

  const closeCropModal = () => {
    setIsCropModalOpen(false);
    setCropClipIndex(null);
  };

  const fillInputWithCurrentPlayerTime = (
    event: MouseEvent<HTMLInputElement>,
    setInputValue: (value: string) => void
  ) => {
    event.preventDefault();

    if (!cropPlayerRef.current) {
      return;
    }

    const currentTime = cropPlayerRef.current.getCurrentTime();
    setInputValue(String(Math.round((currentTime + Number.EPSILON) * 100) / 100));
  };

  const previewCropRange = () => {
    if (!cropPlayerRef.current || cropClipIndex === null) {
      return;
    }

    const clip = clipQueue[cropClipIndex];

    if (!clip || clip.kind !== "youtube") {
      return;
    }

    const start = parseFloat(cropStartInput);
    const end = parseFloat(cropEndInput);

    cropPlayerRef.current.loadVideoById({
      videoId: clip.videoId,
      startSeconds: Number.isFinite(start) ? start : 0,
      endSeconds: Number.isFinite(end) ? end : undefined,
    });
  };

  const saveCropRange = () => {
    if (cropClipIndex === null) {
      return;
    }

    const start = parseFloat(cropStartInput);
    const end = parseFloat(cropEndInput);
    const savedStart = Number.isFinite(start) ? start : 0;
    const savedEnd = Number.isFinite(end) ? end : 86400;

    if (savedStart >= savedEnd) {
      setCropRangeError("Start must be less than end.");
      return;
    }

    setCropRangeError("");

    setClipQueue((previous) => {
      const clip = previous[cropClipIndex];

      if (!clip || clip.kind !== "youtube") {
        return previous;
      }

      const updatedClip: YouTubeClip = { ...clip, start: savedStart, end: savedEnd };
      const nextQueue = [...previous];
      nextQueue[cropClipIndex] = updatedClip;

      setSelectedVideo((currentSelectedVideo) =>
        isSameQueueItem(currentSelectedVideo, clip) ? updatedClip : currentSelectedVideo
      );

      return nextQueue;
    });

    closeCropModal();
  };

  const handleChooseComputerClip = () => {
    setIsAddClipModalOpen(false);
    openFilePicker();
  };

  const handleChooseYouTubeClip = () => {
    setIsAddClipModalOpen(false);
    setYoutubeLink("");
    setYoutubeLinkError("");
    setIsYouTubeModalOpen(true);
  };

  const reusePreviousYouTubeLink = () => {
    const previousYouTubeClip = [...clipQueue].reverse().find((clip): clip is YouTubeClip => clip.kind === "youtube");

    if (!previousYouTubeClip) {
      return;
    }

    setYoutubeLink(previousYouTubeClip.sourceUrl);
    addYouTubeClip(previousYouTubeClip.sourceUrl);
  };

  const addYouTubeClip = (linkOverride?: string) => {
    const linkToUse = linkOverride ?? youtubeLink;
    const videoId = parseYouTubeVideoId(linkToUse);

    if (!videoId) {
      setYoutubeLinkError("Paste a valid YouTube link.");
      return;
    }

    const nextClip: YouTubeClip = {
      kind: "youtube",
      id: createQueueItemId(),
      name: `YouTube: ${videoId}`,
      videoId,
      sourceUrl: linkToUse.trim(),
      start: 0,
      end: 86400,
    };

    setYoutubeLinkError("");
    setClipQueue((previous) => [...previous, nextClip]);
    setSelectedVideo(nextClip);
    setIsYouTubeModalOpen(false);
  };

  const removeClipAtIndex = (indexToRemove: number) => {
    setClipQueue((previous) => {
      const clipToRemove = previous[indexToRemove];

      if (!clipToRemove) {
        return previous;
      }

      if (clipToRemove.kind === "local") {
        URL.revokeObjectURL(clipToRemove.url);
        allObjectUrlsRef.current = allObjectUrlsRef.current.filter((url) => url !== clipToRemove.url);
      }

      const nextQueue = previous.filter((_, index) => index !== indexToRemove);

      setSelectedVideo((currentSelectedVideo) => {
        if (!isSameQueueItem(currentSelectedVideo, clipToRemove)) {
          return currentSelectedVideo;
        }

        return nextQueue[indexToRemove] ?? nextQueue[indexToRemove - 1] ?? null;
      });

      return nextQueue;
    });
  };

  const openDeleteConfirmation = (index: number) => {
    setDeleteClipIndex(index);
  };

  const closeDeleteConfirmation = () => {
    setDeleteClipIndex(null);
  };

  const confirmDeleteClip = () => {
    if (deleteClipIndex === null) {
      return;
    }

    removeClipAtIndex(deleteClipIndex);
    setDeleteClipIndex(null);
  };

  const onVideoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);

    if (selectedFiles.length === 0) {
      return;
    }

    const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/"));

    if (videoFiles.length === 0) {
      setUploadError("Please select a video file.");
      event.target.value = "";
      return;
    }

    setUploadError("");

    const nextClips = await Promise.all(
      videoFiles.map(async (file) => {
        const durationSeconds = await getVideoDurationSeconds(file);
        const videoUrl = URL.createObjectURL(file);
        allObjectUrlsRef.current.push(videoUrl);

        return {
          kind: "local" as const,
          id: createQueueItemId(),
          name: file.name,
          sizeMB: (file.size / (1024 * 1024)).toFixed(2),
          durationSeconds,
          sizeBytes: file.size,
          mimeType: file.type,
          lastModified: file.lastModified,
          url: videoUrl,
        };
      })
    );

    setClipQueue((previous) => [...previous, ...nextClips]);
    setSelectedVideo(nextClips[0]);

    event.target.value = "";
  };

  useEffect(() => {
    selectedClipElementRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedVideo]);

  useEffect(() => {
    const objectUrls = allObjectUrlsRef.current;

    return () => {
      objectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, []);

  useEffect(() => {
    if (document.getElementById("youtube-iframe-api")) {
      return;
    }

    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(script);
  }, []);

  useEffect(() => {
    if (!isCropModalOpen || cropClipIndex === null) {
      return;
    }

    const clip = clipQueue[cropClipIndex];

    if (!clip || clip.kind !== "youtube") {
      return;
    }

    let cancelled = false;

    const createPlayer = () => {
      if (cancelled || !window.YT) {
        return;
      }

      cropPlayerRef.current = new window.YT.Player("crop-preview-player", {
        videoId: clip.videoId,
        playerVars: { autoplay: 0, controls: 1, modestbranding: 1 },
      });
    };

    if (window.YT?.Player) {
      createPlayer();
    } else {
      const previousCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previousCallback?.();
        createPlayer();
      };
    }

    return () => {
      cancelled = true;

      if (cropPlayerRef.current?.destroy) {
        cropPlayerRef.current.destroy();
      }

      cropPlayerRef.current = null;
    };
  }, [isCropModalOpen, cropClipIndex, clipQueue]);

  useEffect(() => {
    if (clipQueue.length === 0) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [clipQueue.length]);

  const exportQueueAsZip = async (requestedName: string) => {
    if (clipQueue.length === 0 || isExportingZip) {
      return;
    }

    const sanitizedBaseName = requestedName.trim() || "playlist-clips";
    const finalFileName = sanitizedBaseName.endsWith(".groupwatch")
      ? sanitizedBaseName
      : `${sanitizedBaseName}.groupwatch`;

    setExportError("");
    setIsExportingZip(true);

    try {
      const zip = new JSZip();
      const localClips = clipQueue.filter((clip): clip is SelectedVideo => clip.kind === "local");
      const youtubeClips = clipQueue.filter((clip): clip is YouTubeClip => clip.kind === "youtube");

      const metadata = {
        format: "groupwatch",
        version: 1,
        exportedAt: new Date().toISOString(),
        clipCount: clipQueue.length,
        localClips: localClips.map((clip) => ({
          name: clip.name,
        })),
        youtubeClips: youtubeClips.map((clip) => ({
          id: clip.videoId,
          start: clip.start,
          end: clip.end,
        })),
      };

      for (const clip of localClips) {
        const response = await fetch(clip.url);
        const blob = await response.blob();
        zip.file(clip.name, blob);
      }

      zip.file("data.json", JSON.stringify(metadata, null, 2));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const downloadUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement("a");

      link.href = downloadUrl;
      link.download = finalFileName;
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
      }, 1000);

      router.push("/");
    } catch {
      setExportError("Failed to export clips as zip.");
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <main className="flex h-screen items-center justify-center overflow-hidden p-12 text-gray-100">
      <section className="grid h-full w-full max-w-7xl gap-4 lg:grid-cols-[1fr_2fr]">
        <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-sky-200/15 bg-main p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <h2 className="text-xl font-semibold text-gray-50">New Collection</h2>
          <p className="mt-2 text-sm text-gray-300">
            Compile a set of video clips to be used in a watch party!
          </p>
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
            <button
              type="button"
              onClick={() => {
                setIsAddClipModalOpen(true);
              }}
              className="gw-btn-primary px-5 py-2"
            >
              Add Clips
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              onChange={onVideoChange}
              className="hidden"
            />

            {uploadError ? <p className="text-sm text-rose-300">{uploadError}</p> : null}

            {selectedVideo ? (
              <div className="min-h-0 flex-1 overflow-hidden text-gray-400">
                {selectedVideo.kind === "local" ? (
                  <video
                    src={selectedVideo.url}
                    controls
                    className="h-full w-full rounded-xl border border-sky-200/15 bg-black/60 object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-sky-200/15 bg-black/60">
                    <iframe
                      key={`${selectedVideo.videoId}-${selectedVideo.start}-${selectedVideo.end}`}
                      src={`https://www.youtube-nocookie.com/embed/${selectedVideo.videoId}?start=${Math.floor(selectedVideo.start)}&end=${Math.floor(selectedVideo.end)}`}
                      title={selectedVideo.name}
                      className="h-full w-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-sky-200/30 min-h-0 flex-1 overflow-hidden text-gray-400"></div>
            )}
          </div>
        </article>

        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30 backdrop-blur">
          <h2 className="text-lg font-semibold text-gray-100">Queue Summary</h2>
          <div className="mt-6 min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            {clipQueue.length > 0 ? (
              <>
                <p className="font-medium text-gray-100">
                  {clipQueue.length} {clipQueue.length === 1 ? "clip" : "clips"} added
                </p>
                  {clipQueue.map((clip, index) => (
                     <div
                       key={clip.id}
                       ref={(element) => {
                         if (isSameQueueItem(selectedVideo, clip)) {
                           selectedClipElementRef.current = element;
                         }
                       }}
                       onClick={() => {
                         setSelectedVideo(clip);
                       }}
                       className={`group relative w-full cursor-pointer rounded-2xl border p-4 pr-28 text-left text-sm text-gray-300 transition ${
                         isSameQueueItem(selectedVideo, clip)
                           ? "border-sky-200/30 bg-gray-800"
                           : "border-sky-200/10 bg-gray-800/40 hover:border-sky-200/25"
                       }`}
                       title={clip.name}
                     >
                       <div
                         className={`pointer-events-none absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-2 transition ${
                           isSameQueueItem(selectedVideo, clip) ? "opacity-100" : "opacity-0"
                         }`}
                       >
                         {clip.kind === "youtube" ? (
                           <button
                             type="button"
                             onClick={(event) => {
                               event.stopPropagation();
                               openCropModal(index);
                             }}
                             className="pointer-events-auto cursor-pointer rounded-full border border-sky-200/30 bg-sky-900/35 px-2 py-1 text-xs font-medium text-sky-100 transition hover:border-sky-200/60 hover:bg-sky-800/50"
                             aria-label={`Crop ${clip.name}`}
                           >
                             Crop
                           </button>
                         ) : null}
                         <button
                           type="button"
                           onClick={(event) => {
                             event.stopPropagation();
                             openDeleteConfirmation(index);
                           }}
                           className="pointer-events-auto text-lg cursor-pointer text-gray-500 transition hover:text-gray-100"
                           aria-label={`Delete ${clip.name}`}
                         >
                           ✕
                         </button>
                       </div>
                       <p>{formatVideoName(clip.name)}</p>
                       <p className="mt-1 text-xs text-gray-400">
                         {clip.kind === "local"
                           ? `Video File • ${formatDuration(clip.durationSeconds)} • ${clip.sizeMB} MB`
                           : `YouTube link`}
                       </p>
                     </div>
                   ))}
              </>
            ) : (
              <p className="text-gray-400">No clips added yet.</p>
            )}
          </div>

          {exportError ? <p className="mt-3 text-sm text-rose-300">{exportError}</p> : null}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                setIsExportModalOpen(true);
              }}
              disabled={clipQueue.length === 0 || isExportingZip}
              className="gw-btn-primary"
            >
              Export
            </button>
          </div>
        </aside>
      </section>

      {isExportModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30">
            <h3 className="text-lg font-semibold text-gray-100">Export This Collection?</h3>
            <input
              type="text"
              onChange={(event) => {
                setPlaylistName(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !isExportingZip) {
                  setIsExportModalOpen(false);
                  void exportQueueAsZip(playlistName);
                }
              }}
              className="mt-4 w-full rounded-xl border border-sky-200/20 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-200/40"
              placeholder="Collection name..."
              autoFocus
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsExportModalOpen(false);
                }}
                className="gw-btn-lesser"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsExportModalOpen(false);
                  void exportQueueAsZip(playlistName);
                }}
                disabled={isExportingZip}
                className="gw-btn-primary"
              >
                Export
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isAddClipModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-md rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30">
            <button
              type="button"
              onClick={() => {
                setIsAddClipModalOpen(false);
              }}
              className="absolute right-6 top-6 cursor-pointer leading-none text-gray-500 transition hover:text-gray-200"
              aria-label="Close"
            >
              ✕
            </button>

            <h3 className="text-lg font-semibold text-gray-100">Add Clips</h3>
            {/* <p className="mt-2 text-sm text-gray-300">Choose a source.</p> */}

            <div className="mt-5 grid grid-cols-2 gap-4">
              <button type="button" onClick={handleChooseComputerClip} className="group flex flex-col items-center gap-2 rounded-xl border border-sky-200/15 bg-gray-800 p-3 transition hover:border-sky-200/40 cursor-pointer">
                <Image src={uploadIcon} alt="" className="aspect-video w-full object-contain p-3" />
                <span className="text-gray-200 transition group-hover:text-sky-100">Upload Video Files</span>
              </button>
              <button type="button" onClick={handleChooseYouTubeClip} className="group flex flex-col items-center gap-2 rounded-xl border border-sky-200/15 bg-gray-800 p-3 transition hover:border-sky-200/40 cursor-pointer">
                <Image src={youtubeLogo} alt="" className="aspect-video w-full object-contain p-3" />
                <span className="text-gray-200 transition group-hover:text-sky-100">YouTube Link</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteClipIndex !== null && clipQueue[deleteClipIndex] ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30">
            <h3 className="text-lg font-semibold text-gray-100">Delete This Clip?</h3>
            <p className="mt-2 text-sm text-gray-300">
              {`${formatVideoName(clipQueue[deleteClipIndex].name)} will be removed from the queue.`}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeDeleteConfirmation} className="gw-btn-lesser">
                Cancel
              </button>
              <button type="button" onClick={confirmDeleteClip} className="gw-btn-danger">
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCropModalOpen && cropClipIndex !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30">
            <h3 className="text-lg font-semibold text-gray-100">Crop Clip</h3>
            <p className="mt-2 text-sm text-gray-300">Set a start and end time, then preview before saving.</p>

            <div className="mt-4 aspect-video w-full overflow-hidden rounded-xl border border-sky-200/15 bg-black/60">
              <div id="crop-preview-player" className="h-full w-full" />
            </div>

            <div className="mt-4 flex gap-3">
              <label className="flex-1 text-sm text-gray-300">
                Start (s)
                <input
                  type="number"
                  min={0}
                  value={cropStartInput}
                  onChange={(event) => {
                    setCropStartInput(event.target.value);
                  }}
                  onContextMenu={(event) => {
                    fillInputWithCurrentPlayerTime(event, setCropStartInput);
                  }}
                  className="mt-1 w-full rounded-xl border border-sky-200/20 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-200/40"
                />
              </label>
              <label className="flex-1 text-sm text-gray-300">
                End (s)
                <input
                  type="number"
                  min={0}
                  value={cropEndInput}
                  onChange={(event) => {
                    setCropEndInput(event.target.value);
                  }}
                  onContextMenu={(event) => {
                    fillInputWithCurrentPlayerTime(event, setCropEndInput);
                  }}
                  placeholder="End of video"
                  className="mt-1 w-full rounded-xl border border-sky-200/20 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-200/40"
                />
              </label>
            </div>

            {cropRangeError ? <p className="mt-3 text-sm text-rose-300">{cropRangeError}</p> : null}

            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={closeCropModal} className="gw-btn-lesser">
                Cancel
              </button>
              <button type="button" onClick={previewCropRange} className="gw-btn">
                Preview
              </button>
              <button type="button" onClick={saveCropRange} className="gw-btn-primary">
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isYouTubeModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl border border-sky-200/15 bg-main p-6 shadow-xl shadow-black/30">
            <h3 className="text-lg font-semibold text-gray-100">Add YouTube Clip</h3>
            <p className="mt-2 text-sm text-gray-300">Paste a YouTube link to add it to the queue summary.</p>

            <input
              type="url"
              value={youtubeLink}
              onChange={(event) => {
                setYoutubeLink(event.target.value);
                setYoutubeLinkError("");
              }}
              className="mt-4 w-full rounded-xl border border-sky-200/20 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-200/40"
              placeholder="https://www.youtube.com/watch?v=..."
              autoFocus
            />

            {clipQueue.some((clip) => clip.kind === "youtube") ? (
              <button
                type="button"
                onClick={reusePreviousYouTubeLink}
                className="mt-2 cursor-pointer text-sm text-sky-300 transition hover:text-sky-100 hover:underline"
              >
                Add previous video again
              </button>
            ) : null}

            {youtubeLinkError ? <p className="mt-2 text-sm text-rose-300">{youtubeLinkError}</p> : null}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setIsYouTubeModalOpen(false);
                }}
                className="gw-btn-lesser"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  addYouTubeClip();
                }}
                className="gw-btn-primary"
              >
                Add Clip
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
