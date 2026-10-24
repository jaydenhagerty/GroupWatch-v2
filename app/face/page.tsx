"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";

type TrackedFace = {
  left: number;
  top: number;
  width: number;
  height: number;
  smile: number;
};

type FaceRegion = {
  id: number;
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  count: number;
};

type FaceSmileTrack = {
  id: number;
  centerX: number;
  centerY: number;
  smile: number;
};

type RegionInteraction = {
  mode: "draw" | "move" | "resize";
  pointerX: number;
  pointerY: number;
  region?: FaceRegion;
};

const MAX_DETECTED_FACES = 100;
const MIN_REGION_SIZE = 3;

function getCameraError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was denied. Allow camera access in your browser settings and try again.";
    }

    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No camera was found. Connect a webcam and try again.";
    }

    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Your camera could not be started. It may already be in use by another app.";
    }
  }

  return error instanceof Error
    ? `Could not start face tracking: ${error.message}`
    : "Could not start face tracking. Please try again.";
}

export default function FacePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker[] | null>(null);
  const tileCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const faceTracksRef = useRef<FaceSmileTrack[]>([]);
  const nextFaceTrackIdRef = useRef(1);
  const smileThresholdRef = useRef(60);
  const regionDelayRef = useRef(3);
  const soundEnabledRef = useRef(true);
  const boomAudioRef = useRef<HTMLAudioElement | null>(null);
  const regionLastCountedAtRef = useRef(new Map<number, number>());
  const regionsRef = useRef<FaceRegion[]>([]);
  const nextRegionIdRef = useRef(1);
  const interactionRef = useRef<RegionInteraction | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [faces, setFaces] = useState<TrackedFace[]>([]);
  const [regions, setRegions] = useState<FaceRegion[]>([]);
  const [isDrawingRegion, setIsDrawingRegion] = useState(false);
  const [draftRegion, setDraftRegion] = useState<Omit<FaceRegion, "id" | "name" | "count"> | null>(null);
  const [smileThreshold, setSmileThreshold] = useState(60);
  const [regionDelay, setRegionDelay] = useState("3");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [error, setError] = useState("");

  const updateRegions = useCallback(
    (update: (current: FaceRegion[]) => FaceRegion[]) => {
      setRegions((current) => {
        const next = update(current);
        regionsRef.current = next;
        return next;
      });
    },
    [],
  );

  const getPointerPosition = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };

  const handleRegionPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isDrawingRegion) {
      const point = getPointerPosition(event);
      interactionRef.current = { mode: "draw", pointerX: point.x, pointerY: point.y };
      setDraftRegion({ left: point.x, top: point.y, width: 0, height: 0 });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if ((event.target as HTMLElement).closest("[data-region-control]")) {
      return;
    }

    const regionId = Number((event.target as HTMLElement).closest("[data-region-id]")?.getAttribute("data-region-id"));
    const region = regionsRef.current.find((candidate) => candidate.id === regionId);
    if (!region) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const point = getPointerPosition(event);
    const mode = (event.target as HTMLElement).closest("[data-region-resize]")
      ? "resize"
      : "move";
    interactionRef.current = { mode, pointerX: point.x, pointerY: point.y, region };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleRegionPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    if (!interaction) {
      return;
    }

    const point = getPointerPosition(event);
    const deltaX = point.x - interaction.pointerX;
    const deltaY = point.y - interaction.pointerY;

    if (interaction.mode === "draw") {
      setDraftRegion({
        left: Math.min(interaction.pointerX, point.x),
        top: Math.min(interaction.pointerY, point.y),
        width: Math.abs(deltaX),
        height: Math.abs(deltaY),
      });
      return;
    }

    const original = interaction.region;
    if (!original) {
      return;
    }

    updateRegions((current) =>
      current.map((region) => {
        if (region.id !== original.id) {
          return region;
        }

        if (interaction.mode === "move") {
          return {
            ...region,
            left: Math.max(0, Math.min(100 - region.width, original.left + deltaX)),
            top: Math.max(0, Math.min(100 - region.height, original.top + deltaY)),
          };
        }

        return {
          ...region,
          width: Math.max(MIN_REGION_SIZE, Math.min(100 - original.left, original.width + deltaX)),
          height: Math.max(MIN_REGION_SIZE, Math.min(100 - original.top, original.height + deltaY)),
        };
      }),
    );
  };

  const handleRegionPointerUp = () => {
    const interaction = interactionRef.current;
    if (interaction?.mode === "draw" && draftRegion &&
      draftRegion.width >= MIN_REGION_SIZE && draftRegion.height >= MIN_REGION_SIZE) {
      const id = nextRegionIdRef.current++;
      updateRegions((current) => [
        ...current,
        {
          id,
          name: `Region ${id}`,
          ...draftRegion,
          count: 0,
        },
      ]);
      setIsDrawingRegion(false);
    }

    interactionRef.current = null;
    setDraftRegion(null);
  };

  const stopTracking = useCallback(() => {
    generationRef.current += 1;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    landmarkerRef.current?.forEach((landmarker) => landmarker.close());
    landmarkerRef.current = null;
    setIsStarting(false);
    setIsTracking(false);
    setFaces([]);
  }, []);

  useEffect(() => stopTracking, [stopTracking]);

  const startTracking = async () => {
    const generation = ++generationRef.current;
    setError("");
    setIsStarting(true);
    setFaces([]);
    faceTracksRef.current = [];

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access requires a secure connection (HTTPS or localhost).");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      if (generation !== generationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;

      if (!video) {
        throw new Error("The webcam preview could not be initialized.");
      }

      video.srcObject = stream;
      await video.play();

      const { FaceLandmarker, FilesetResolver } = await import(
        "@mediapipe/tasks-vision"
      );
      const originalConsoleError = console.error;
      const filteredConsoleError: typeof console.error = (...args) => {
        if (
          args.some(
            (argument) =>
              typeof argument === "string" &&
              argument.includes("Created TensorFlow Lite XNNPACK delegate for CPU."),
          )
        ) {
          return;
        }

        originalConsoleError.apply(console, args);
      };
      console.error = filteredConsoleError;

      let landmarkers: FaceLandmarker[];
      try {
        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm",
        );
        const options = {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          },
          runningMode: "VIDEO" as const,
          numFaces: MAX_DETECTED_FACES,
          minFaceDetectionConfidence: 0.2,
          minFacePresenceConfidence: 0.2,
          minTrackingConfidence: 0.2,
          outputFaceBlendshapes: true,
        };

        const createLandmarker = async () => {
          try {
            return await FaceLandmarker.createFromOptions(fileset, {
              ...options,
              baseOptions: { ...options.baseOptions, delegate: "GPU" },
            });
          } catch {
            return await FaceLandmarker.createFromOptions(fileset, options);
          }
        };

        landmarkers = [await createLandmarker()];
        if (video.videoWidth !== video.videoHeight) {
          landmarkers.push(await createLandmarker());
        }
      } finally {
        if (console.error === filteredConsoleError) {
          console.error = originalConsoleError;
        }
      }

      if (generation !== generationRef.current) {
        landmarkers.forEach((landmarker) => landmarker.close());
        return;
      }

      landmarkerRef.current = landmarkers;
      setIsStarting(false);
      setIsTracking(true);

      let lastDetection = 0;
      const detect = (timestamp: number) => {
        if (
          generation !== generationRef.current ||
          !videoRef.current ||
          !landmarkerRef.current
        ) {
          return;
        }

        if (
          videoRef.current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          timestamp - lastDetection >= 80
        ) {
          lastDetection = timestamp;
          const video = videoRef.current;
          const videoWidth = video.videoWidth;
          const videoHeight = video.videoHeight;
          const side = Math.min(videoWidth, videoHeight);
          const tileCount = landmarkerRef.current.length;
          const canvas = (tileCanvasRef.current ??= document.createElement("canvas"));
          canvas.width = side;
          canvas.height = side;
          const tileContext = canvas.getContext("2d");
          const candidates: {
            landmarks: { x: number; y: number }[];
            categories: { categoryName: string; score: number }[];
            offCenter: number;
          }[] = [];

          // The model downsamples its input to a tiny square, so running it on
          // square tiles of the frame keeps far-away faces larger than a full
          // letterboxed frame would.
          landmarkerRef.current.forEach((tileLandmarker, tileIndex) => {
            const shift = tileCount > 1 ? tileIndex / (tileCount - 1) : 0.5;
            const offsetX = (videoWidth - side) * shift;
            const offsetY = (videoHeight - side) * shift;
            tileContext?.drawImage(
              video,
              offsetX,
              offsetY,
              side,
              side,
              0,
              0,
              side,
              side,
            );
            const tileResult = tileLandmarker.detectForVideo(canvas, timestamp);

            tileResult.faceLandmarks.forEach((tileLandmarks, index) => {
              const centerX =
                tileLandmarks.reduce((sum, landmark) => sum + landmark.x, 0) /
                tileLandmarks.length;
              const centerY =
                tileLandmarks.reduce((sum, landmark) => sum + landmark.y, 0) /
                tileLandmarks.length;
              candidates.push({
                landmarks: tileLandmarks.map((landmark) => ({
                  x: (offsetX + landmark.x * side) / videoWidth,
                  y: (offsetY + landmark.y * side) / videoHeight,
                })),
                categories: tileResult.faceBlendshapes[index]?.categories ?? [],
                offCenter: Math.hypot(centerX - 0.5, centerY - 0.5),
              });
            });
          });

          // Faces in the overlap between tiles are found twice; keep the one
          // that sits closer to the middle of its tile.
          const mergedFaces: typeof candidates = [];
          candidates.forEach((candidate) => {
            const bounds = (landmarks: { x: number; y: number }[]) => {
              const xs = landmarks.map((landmark) => landmark.x * videoWidth);
              const ys = landmarks.map((landmark) => landmark.y * videoHeight);
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              return {
                centerX: (minX + maxX) / 2,
                centerY: (minY + maxY) / 2,
                size: Math.max(maxX - minX, maxY - minY),
              };
            };
            const candidateBounds = bounds(candidate.landmarks);
            const duplicateIndex = mergedFaces.findIndex((existing) => {
              const existingBounds = bounds(existing.landmarks);
              return (
                Math.hypot(
                  existingBounds.centerX - candidateBounds.centerX,
                  existingBounds.centerY - candidateBounds.centerY,
                ) <
                0.5 * Math.max(existingBounds.size, candidateBounds.size)
              );
            });

            if (duplicateIndex === -1) {
              mergedFaces.push(candidate);
            } else if (candidate.offCenter < mergedFaces[duplicateIndex].offCenter) {
              mergedFaces[duplicateIndex] = candidate;
            }
          });

          const detectedFaces = mergedFaces.map(({ landmarks, categories }) => {
              const xs = landmarks.map((landmark) => landmark.x);
              const ys = landmarks.map((landmark) => landmark.y);
              const left = Math.min(...xs);
              const top = Math.min(...ys);
              const right = Math.max(...xs);
              const bottom = Math.max(...ys);
              const smileLeft =
                categories.find((category) => category.categoryName === "mouthSmileLeft")
                  ?.score ?? 0;
              const smileRight =
                categories.find((category) => category.categoryName === "mouthSmileRight")
                  ?.score ?? 0;

              return {
                left: left * 100,
                top: top * 100,
                width: (right - left) * 100,
                height: (bottom - top) * 100,
                smile: Math.round(((smileLeft + smileRight) / 2) * 100),
              };
            });

          const availableTracks = [...faceTracksRef.current];
          const nextTracks: FaceSmileTrack[] = [];
          const countRegionIds: number[] = [];

          detectedFaces.forEach((face) => {
            const centerX = 1 - (face.left + face.width / 2) / 100;
            const centerY = (face.top + face.height / 2) / 100;
            let closestIndex = -1;
            let closestDistance = Infinity;

            availableTracks.forEach((track, index) => {
              const distance = Math.hypot(
                centerX - track.centerX,
                centerY - track.centerY,
              );
              if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
              }
            });

            const previousTrack =
              closestIndex >= 0 && closestDistance <= 0.2
                ? availableTracks.splice(closestIndex, 1)[0]
                : undefined;
            const smiling = face.smile >= smileThresholdRef.current;
            const track = {
              id: previousTrack?.id ?? nextFaceTrackIdRef.current++,
              centerX,
              centerY,
              smile: face.smile,
            };
            nextTracks.push(track);

            if (
              smiling &&
              (!previousTrack ||
                previousTrack.smile < smileThresholdRef.current)
            ) {
              const region = regionsRef.current.find(
                (candidate) =>
                  centerX * 100 >= candidate.left &&
                  centerX * 100 <= candidate.left + candidate.width &&
                  centerY * 100 >= candidate.top &&
                  centerY * 100 <= candidate.top + candidate.height,
              );
              if (region) {
                const lastCountedAt =
                  regionLastCountedAtRef.current.get(region.id) ?? -Infinity;
                if (
                  timestamp - lastCountedAt >=
                  regionDelayRef.current * 1000
                ) {
                  regionLastCountedAtRef.current.set(region.id, timestamp);
                  countRegionIds.push(region.id);
                }
              }
            }
          });

          faceTracksRef.current = nextTracks;
          setFaces(detectedFaces);

          if (countRegionIds.length > 0) {
            if (soundEnabledRef.current) {
              const audio = (boomAudioRef.current ??= new Audio("/vine-boom.mp3"));
              audio.currentTime = 0;
              audio.play().catch(() => {});
            }
            updateRegions((current) =>
              current.map((region) => ({
                ...region,
                count:
                  region.count +
                  countRegionIds.filter((id) => id === region.id).length,
              })),
            );
          }
        }

        animationFrameRef.current = requestAnimationFrame(detect);
      };

      animationFrameRef.current = requestAnimationFrame(detect);
    } catch (trackingError) {
      if (generation === generationRef.current) {
        stopTracking();
        setError(getCameraError(trackingError));
      }
    }
  };

  return (
    <main className="min-h-dvh px-3 py-3 text-gray-100 sm:px-5 sm:py-4 lg:h-dvh lg:overflow-hidden">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col lg:h-full">

        <section className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-[60vh] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#10151e] shadow-2xl shadow-black/30 lg:min-h-0">
            <div className="relative flex min-h-[45vh] flex-1 items-center justify-center overflow-hidden bg-[#090c11] lg:min-h-0">
              <div className="relative aspect-video max-h-full w-full max-w-full">
                <video
                  ref={videoRef}
                  className={`absolute inset-0 h-full w-full object-cover ${isTracking || isStarting ? "scale-x-[-1]" : "hidden"}`}
                  autoPlay
                  muted
                  playsInline
                  aria-label="Live webcam preview"
                />

                {(isTracking || isStarting) && (
                  <div
                    className={`absolute inset-0 touch-none ${isDrawingRegion ? "cursor-crosshair" : ""}`}
                    onPointerDown={handleRegionPointerDown}
                    onPointerMove={handleRegionPointerMove}
                    onPointerUp={handleRegionPointerUp}
                    onPointerCancel={handleRegionPointerUp}
                  >
                  <div className="pointer-events-none absolute inset-0 scale-x-[-1]">
                    {faces.map((face, index) => (
                      <div
                        key={index}
                        className="absolute rounded-[42%] border-2 border-sky-300 shadow-[0_0_22px_rgba(56,189,248,0.32)]"
                        style={{
                          left: `${face.left}%`,
                          top: `${face.top}%`,
                          width: `${face.width}%`,
                          height: `${face.height}%`,
                        }}
                      />
                    ))}
                  </div>

                  {regions.map((region) => (
                    <div
                      key={region.id}
                      data-region-id={region.id}
                      className="absolute border-2 border-amber-300/90 bg-transparent"
                      style={{
                        left: `${region.left}%`,
                        top: `${region.top}%`,
                        width: `${region.width}%`,
                        height: `${region.height}%`,
                      }}
                    >
                      <span
                        className="absolute left-1 top-1 rounded-md bg-black/70 px-2 py-1 text-xs font-medium text-amber-100"
                      >
                        {region.name} · {region.count}
                      </span>
                      <span
                        data-region-resize
                        className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border border-amber-100 bg-amber-300"
                        aria-hidden="true"
                      />
                    </div>
                  ))}

                  {draftRegion && (
                    <div
                      className="pointer-events-none absolute border-2 border-dashed border-sky-200 bg-sky-300/10"
                      style={{
                        left: `${draftRegion.left}%`,
                        top: `${draftRegion.top}%`,
                        width: `${draftRegion.width}%`,
                        height: `${draftRegion.height}%`,
                      }}
                    />
                  )}
                  </div>
                )}
              </div>

              {!isTracking && !isStarting && (
                <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-sky-300/20 bg-sky-300/10 text-sky-200">
                    <svg viewBox="0 0 24 24" fill="none" className="h-8 w-8" aria-hidden="true">
                      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeWidth="1.6" />
                      <path d="m16 10 4-2v8l-4-2M8 12h.01M12 12h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="text-base font-medium text-white">Your webcam will appear here</p>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-gray-400">
                    Start the camera when you’re ready. Face analysis runs locally in your browser.
                  </p>
                </div>
              )}

              {isStarting && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-black/60 px-5 py-4 text-sm text-gray-200 backdrop-blur">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-sky-300" />
                  Preparing the camera and face tracker…
                </div>
              )}

              {isTracking && faces.length === 0 && (
                <div className="absolute inset-x-0 bottom-0 bg-black/55 px-5 py-3 text-center text-sm text-gray-200 backdrop-blur">
                  No faces in view yet — move into the frame.
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
              <p className="text-sm text-gray-400">
                {isTracking
                  ? `${faces.length} ${faces.length === 1 ? "face" : "faces"} detected`
                  : "Camera access is only used while tracking"}
              </p>
              {isTracking ? (
                <button className="gw-btn-danger px-5 py-2.5" onClick={stopTracking}>
                  Stop camera
                </button>
              ) : (
                <button
                  className="gw-btn-primary px-5 py-2.5"
                  onClick={startTracking}
                  disabled={isStarting}
                >
                  {isStarting ? "Starting…" : "Start camera"}
                </button>
              )}
            </div>
            {isDrawingRegion && (
              <p className="border-t border-white/10 px-5 py-2 text-sm text-sky-200">
                Drag to draw a region
              </p>
            )}
          </div>

          <aside className="max-h-[42vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#10151e] p-4 shadow-xl shadow-black/20 lg:max-h-none lg:min-h-0">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Face tracking</h2>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-gray-400">
                {faces.length} detected
              </span>
            </div>

            <div className="mb-4 space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
              <div className="flex min-h-8 items-center gap-3">
                <label htmlFor="smile-threshold" className="shrink-0 text-sm font-medium text-gray-200">
                  Smile
                </label>
                <input
                  id="smile-threshold"
                  type="range"
                  min="0"
                  max="95"
                  step="5"
                  value={smileThreshold}
                  onChange={(event) => {
                    const threshold = Number(event.target.value);
                    smileThresholdRef.current = threshold;
                    setSmileThreshold(threshold);
                  }}
                  className="w-full accent-sky-400 cursor-pointer"
                />
                <span className="w-10 text-right text-sm tabular-nums text-sky-200">
                  {smileThreshold}%
                </span>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                <label htmlFor="region-delay" className="text-sm font-medium text-gray-200">
                  Repeat delay
                </label>
                <div className="flex shrink-0 items-center gap-3">
                  <input
                    id="region-delay"
                    type="number"
                    min="0"
                    step="0.5"
                    value={regionDelay}
                    onChange={(event) => {
                      const value = event.target.value;
                      const delay = Number(value);
                      setRegionDelay(value);
                      if (value !== "" && Number.isFinite(delay) && delay >= 0) {
                        regionDelayRef.current = delay;
                      }
                    }}
                    onBlur={() => {
                      if (
                        regionDelay === "" ||
                        !Number.isFinite(Number(regionDelay)) ||
                        Number(regionDelay) < 0
                      ) {
                        setRegionDelay(String(regionDelayRef.current));
                      }
                    }}
                    aria-label="Repeat delay in seconds"
                    className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-left text-sm text-gray-100 outline-none focus:border-sky-300/50"
                  />
                  <span className="text-sm text-gray-400">sec</span>
                </div>
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                <label htmlFor="vine-boom" className="text-sm font-medium text-gray-200">
                  Vine boom
                </label>
                <input
                  id="vine-boom"
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(event) => {
                    soundEnabledRef.current = event.target.checked;
                    setSoundEnabled(event.target.checked);
                  }}
                  className="h-4 w-4 cursor-pointer accent-sky-400"
                />
              </div>
            </div>

            {faces.length > 0 ? (
              <ul className="space-y-2">
                {faces.map((face, index) => (
                  <li
                    key={index}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-200">Face {index + 1}</span>
                      <span className="text-sm font-semibold tabular-nums text-sky-200">
                        {face.smile}%
                      </span>
                    </div>
                    <div
                      className="h-1.5 overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                      aria-label={`Face ${index + 1} smile estimate`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={face.smile}
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-300 transition-[width] duration-150"
                        style={{ width: `${face.smile}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
                <p className="text-sm text-gray-400">
                  {isTracking ? "Waiting for a face…" : "Start the camera to see smile estimates."}
                </p>
              </div>
            )}

            <div className="mt-4 border-t border-white/[0.08] pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Regions</h3>
                </div>
                <button
                  className="gw-btn px-3 py-2 text-xs"
                  onClick={() => setIsDrawingRegion((current) => !current)}
                  disabled={!isTracking}
                >
                  {isDrawingRegion ? "Cancel" : "Add region"}
                </button>
              </div>

              {regions.length > 0 ? (
                <ul className="space-y-2">
                  {regions.map((region) => (
                    <li
                      key={region.id}
                      className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-2"
                    >
                      <label className="sr-only" htmlFor={`region-name-${region.id}`}>
                        Region name
                      </label>
                      <input
                        id={`region-name-${region.id}`}
                        data-region-control
                        className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-sm text-gray-100 outline-none focus:border-amber-300/50"
                        value={region.name}
                        maxLength={24}
                        onChange={(event) =>
                          updateRegions((current) =>
                            current.map((candidate) =>
                              candidate.id === region.id
                                ? { ...candidate, name: event.target.value }
                                : candidate,
                            ),
                          )
                        }
                      />
                      <span className="min-w-8 text-center text-sm font-semibold tabular-nums text-amber-200">
                        {region.count}
                      </span>
                      <button
                        type="button"
                        data-region-control
                        className="rounded-lg px-2 py-2 text-xs text-gray-400 hover:bg-white/10 hover:text-white cursor-pointer"
                        onClick={() => {
                          updateRegions((current) =>
                            current.map((candidate) =>
                              candidate.id === region.id
                                ? { ...candidate, count: 0 }
                                : candidate,
                            ),
                          );
                          regionLastCountedAtRef.current.delete(region.id);
                        }}
                        aria-label={`Reset ${region.name} counter`}
                        title="Reset counter"
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        data-region-control
                        className="rounded-lg px-2 py-2 text-xs text-gray-400 hover:bg-rose-400/10 hover:text-rose-200 cursor-pointer"
                        onClick={() => {
                          regionLastCountedAtRef.current.delete(region.id);
                          updateRegions((current) =>
                            current.filter((candidate) => candidate.id !== region.id),
                          );
                        }}
                        aria-label={`Remove ${region.name}`}
                        title="Remove region"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-sm text-gray-400">
                  {isTracking ? "No regions yet" : "Start camera to add regions"}
                </p>
              )}
            </div>

          </aside>
        </section>

        {error && (
          <p
            className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
            role="alert"
          >
            {error}
          </p>
        )}

      </div>
    </main>
  );
}