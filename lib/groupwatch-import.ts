import JSZip from "jszip";

export type LocalVideoEntry = {
  kind: "local";
  archiveId: string;
  name: string;
};

export type YouTubeVideoEntry = {
  kind: "youtube";
  id: string;
  start: number;
  end: number;
};

export type VideoEntry = LocalVideoEntry | YouTubeVideoEntry;

export type ProcessedWatchFiles = {
  entries: VideoEntry[];
  archives: Record<string, JSZip>;
};

function isVideoEntry(name: string) {
  return /\.(mp4|webm|ogg|mov|m4v)$/i.test(name);
}

export function extractYouTubeEntries(parsed: unknown): YouTubeVideoEntry[] {
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const parsedObject = parsed as {
    youtubeClips?: Array<{ id?: unknown; start?: unknown; end?: unknown }>;
    YouTubeClips?: Array<{ id?: unknown; start?: unknown; end?: unknown }>;
    items?: Array<{ id?: unknown; start?: unknown; end?: unknown }>;
  };

  const youtubeClipArrays = [
    parsedObject.youtubeClips,
    parsedObject.YouTubeClips,
    parsedObject.items,
  ].filter(Array.isArray) as Array<Array<{ id?: unknown; start?: unknown; end?: unknown }>>;

  const entries: YouTubeVideoEntry[] = [];

  for (const youtubeArray of youtubeClipArrays) {
    for (const youtubeClip of youtubeArray) {
      if (
        typeof youtubeClip?.id !== "string" ||
        typeof youtubeClip?.start !== "number" ||
        typeof youtubeClip?.end !== "number" ||
        youtubeClip.end <= youtubeClip.start
      ) {
        continue;
      }

      entries.push({
        kind: "youtube",
        id: youtubeClip.id,
        start: youtubeClip.start,
        end: youtubeClip.end,
      });
    }
  }

  return entries;
}

async function buildQueueEntriesFromArchive(zip: JSZip, archiveId: string): Promise<VideoEntry[]> {
  const dataFile = zip.file("data.json");
  const queueEntries: VideoEntry[] = [];

  if (dataFile) {
    try {
      const raw = await dataFile.async("text");
      const parsed: unknown = JSON.parse(raw);

      if (parsed && typeof parsed === "object") {
        const parsedObject = parsed as {
          localClips?: Array<{ name?: unknown }>;
        };

        if (Array.isArray(parsedObject.localClips)) {
          for (const localClip of parsedObject.localClips) {
            if (typeof localClip?.name !== "string" || !zip.file(localClip.name)) {
              continue;
            }

            queueEntries.push({
              kind: "local",
              archiveId,
              name: localClip.name,
            });
          }
        }

        queueEntries.push(...extractYouTubeEntries(parsed));
      }
    } catch {
      // Ignore malformed data.json and fall back to scanning the archive.
    }
  }

  if (queueEntries.length > 0) {
    return queueEntries;
  }

  return Object.values(zip.files)
    .filter((zipEntry) => !zipEntry.dir && isVideoEntry(zipEntry.name))
    .map((zipEntry) => ({
      kind: "local" as const,
      archiveId,
      name: zipEntry.name,
    }));
}

export async function processWatchFiles(files: File[]): Promise<ProcessedWatchFiles> {
  const entries: VideoEntry[] = [];
  const archives: Record<string, JSZip> = {};

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const isArchive = file.name.endsWith(".groupwatch") || file.name.endsWith(".zip");
    const isJson = file.name.endsWith(".json");

    if (!isArchive && !isJson) {
      continue;
    }

    if (isJson) {
      try {
        const parsed: unknown = JSON.parse(await file.text());
        entries.push(...extractYouTubeEntries(parsed));
      } catch {
        // Ignore malformed JSON files.
      }
      continue;
    }

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const archiveId = `${file.name}-${Date.now()}-${index}`;

    archives[archiveId] = zip;
    entries.push(...(await buildQueueEntriesFromArchive(zip, archiveId)));
  }

  return { entries, archives };
}