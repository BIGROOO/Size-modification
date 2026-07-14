"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type JobStatus =
  | "queued"
  | "resizing"
  | "ocr"
  | "ready"
  | "writing"
  | "saved"
  | "error";

interface LocalWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface LocalFileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<LocalWritable>;
}

interface LocalDirectoryHandle {
  values(): AsyncIterableIterator<
    LocalFileHandle | { kind: "directory"; name: string }
  >;
}

interface ImageJob {
  id: string;
  file: File;
  handle?: LocalFileHandle;
  sourceUrl: string;
  resultUrl?: string;
  processedBlob?: Blob;
  originalWidth?: number;
  originalHeight?: number;
  ocrText: string;
  confidence?: number;
  status: JobStatus;
  progress: number;
  message?: string;
}

interface DuplicateGroup {
  id: string;
  files: [string, string];
  kind: "完全相同" | "高度相似" | "重复长句";
  similarity: number;
  snippet: string;
}

const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_DIMENSION = 8192;
const LOW_CONFIDENCE = 60;

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function bigramDice(a: string, b: string) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const grams = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const gram = a.slice(index, index + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const gram = b.slice(index, index + 2);
    const count = grams.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      grams.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (a.length + b.length - 2);
}

function getLongSegments(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[。！？!?；;\n\r]+/)
    .map((segment) => segment.trim())
    .filter((segment) => {
      const normalized = normalizeText(segment);
      const hasChinese = /[\p{Script=Han}]/u.test(normalized);
      return hasChinese ? normalized.length >= 8 : normalized.length >= 20;
    });
}

function findDuplicateGroups(jobs: ImageJob[]) {
  const groups: DuplicateGroup[] = [];
  const readable = jobs.filter((job) => normalizeText(job.ocrText).length >= 8);

  for (let left = 0; left < readable.length; left += 1) {
    for (let right = left + 1; right < readable.length; right += 1) {
      const a = readable[left];
      const b = readable[right];
      const normalizedA = normalizeText(a.ocrText);
      const normalizedB = normalizeText(b.ocrText);
      const similarity = bigramDice(normalizedA, normalizedB);

      if (normalizedA === normalizedB) {
        groups.push({
          id: `${a.id}-${b.id}`,
          files: [a.file.name, b.file.name],
          kind: "完全相同",
          similarity: 1,
          snippet: a.ocrText.trim().slice(0, 88),
        });
        continue;
      }

      if (similarity >= 0.85) {
        groups.push({
          id: `${a.id}-${b.id}`,
          files: [a.file.name, b.file.name],
          kind: "高度相似",
          similarity,
          snippet: a.ocrText.trim().slice(0, 88),
        });
        continue;
      }

      const normalizedBText = normalizeText(b.ocrText);
      const shared = getLongSegments(a.ocrText).find((segment) =>
        normalizedBText.includes(normalizeText(segment)),
      );

      if (shared) {
        groups.push({
          id: `${a.id}-${b.id}`,
          files: [a.file.name, b.file.name],
          kind: "重复长句",
          similarity,
          snippet: shared.slice(0, 88),
        });
      }
    }
  }

  return groups;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("无法生成目标图片"))),
      type,
      type === "image/jpeg" || type === "image/webp" ? 0.94 : undefined,
    );
  });
}

async function resizeImage(
  file: File,
  width: number,
  height: number,
  background: string,
) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    bitmap.close();
    throw new Error("当前浏览器无法处理图片画布");
  }

  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const drawWidth = Math.max(1, Math.round(bitmap.width * scale));
  const drawHeight = Math.max(1, Math.round(bitmap.height * scale));
  const x = Math.round((width - drawWidth) / 2);
  const y = Math.round((height - drawHeight) / 2);

  context.drawImage(bitmap, x, y, drawWidth, drawHeight);
  const type = SUPPORTED_TYPES.has(file.type) ? file.type : "image/png";
  const blob = await canvasToBlob(canvas, type);
  const originalWidth = bitmap.width;
  const originalHeight = bitmap.height;
  bitmap.close();

  return { blob, originalWidth, originalHeight };
}

function statusLabel(job: ImageJob) {
  if (job.status === "resizing") return "调整尺寸";
  if (job.status === "ocr") return `识别文案 ${job.progress}%`;
  if (job.status === "writing") return "正在覆盖";
  if (job.status === "saved") return "已完成";
  if (job.status === "error") return "需要检查";
  if (job.status === "ready" && (job.confidence ?? 100) < LOW_CONFIDENCE) {
    return "建议人工检查";
  }
  if (job.status === "ready") return "处理完成";
  return "等待处理";
}

export default function Home() {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [sizeMode, setSizeMode] = useState<"800" | "1000" | "custom">("800");
  const [targetWidth, setTargetWidth] = useState(800);
  const [targetHeight, setTargetHeight] = useState(800);
  const [background, setBackground] = useState("#ffffff");
  const [processing, setProcessing] = useState(false);
  const [folderMode, setFolderMode] = useState(false);
  const [folderApiAvailable, setFolderApiAvailable] = useState(false);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [notice, setNotice] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef<ImageJob[]>([]);
  const lastRenderedConfig = useRef("");

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  useEffect(() => {
    const pickerWindow = window as unknown as {
      showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<LocalDirectoryHandle>;
    };
    const timer = window.setTimeout(
      () => setFolderApiAvailable(typeof pickerWindow.showDirectoryPicker === "function"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      jobsRef.current.forEach((job) => {
        URL.revokeObjectURL(job.sourceUrl);
        if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
      });
    };
  }, []);

  const completedCount = jobs.filter(
    (job) => job.status === "ready" || job.status === "saved" || job.status === "error",
  ).length;
  const overallProgress = jobs.length
    ? Math.round(
        jobs.reduce((sum, job) => {
          if (["ready", "saved", "error"].includes(job.status)) return sum + 100;
          if (job.status === "ocr") return sum + Math.max(30, job.progress);
          if (job.status === "resizing") return sum + 12;
          return sum;
        }, 0) / jobs.length,
      )
    : 0;

  const duplicateFileCount = useMemo(
    () => new Set(duplicates.flatMap((group) => group.files)).size,
    [duplicates],
  );

  function updateMode(mode: "800" | "1000" | "custom") {
    setSizeMode(mode);
    if (mode === "800") {
      setTargetWidth(800);
      setTargetHeight(800);
    }
    if (mode === "1000") {
      setTargetWidth(1000);
      setTargetHeight(1000);
    }
  }

  function disposeJobs() {
    jobsRef.current.forEach((job) => {
      URL.revokeObjectURL(job.sourceUrl);
      if (job.resultUrl) URL.revokeObjectURL(job.resultUrl);
    });
  }

  async function processFiles(files: Array<{ file: File; handle?: LocalFileHandle }>) {
    disposeJobs();
    setDuplicates([]);
    setNotice("");
    setProcessing(true);
    lastRenderedConfig.current = `${targetWidth}x${targetHeight}-${background}`;

    let working: ImageJob[] = files.map(({ file, handle }, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      file,
      handle,
      sourceUrl: URL.createObjectURL(file),
      ocrText: "",
      status: "queued",
      progress: 0,
    }));

    const commit = (index: number, patch: Partial<ImageJob>) => {
      working[index] = { ...working[index], ...patch };
      jobsRef.current = working;
      setJobs([...working]);
    };

    setJobs(working);
    jobsRef.current = working;

    for (let index = 0; index < working.length; index += 1) {
      commit(index, { status: "resizing", progress: 8, message: undefined });
      try {
        const resized = await resizeImage(
          working[index].file,
          targetWidth,
          targetHeight,
          background,
        );
        commit(index, {
          processedBlob: resized.blob,
          resultUrl: URL.createObjectURL(resized.blob),
          originalWidth: resized.originalWidth,
          originalHeight: resized.originalHeight,
          status: "queued",
          progress: 20,
        });
      } catch (error) {
        commit(index, {
          status: "error",
          progress: 100,
          message: error instanceof Error ? error.message : "图片尺寸处理失败",
        });
      }
    }

    let activeIndex = -1;
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["chi_sim", "eng"], 1, {
        logger: (message) => {
          if (activeIndex >= 0 && message.status === "recognizing text") {
            commit(activeIndex, {
              status: "ocr",
              progress: Math.max(20, Math.round(message.progress * 100)),
            });
          }
        },
      });

      for (let index = 0; index < working.length; index += 1) {
        if (!working[index].processedBlob) continue;
        activeIndex = index;
        commit(index, { status: "ocr", progress: 20 });
        try {
          const result = await worker.recognize(working[index].file);
          const text = result.data.text.trim();
          commit(index, {
            ocrText: text,
            confidence: result.data.confidence,
            status: "ready",
            progress: 100,
            message: text ? undefined : "没有识别到文字，建议人工检查",
          });
        } catch (error) {
          commit(index, {
            status: "error",
            progress: 100,
            message: error instanceof Error ? error.message : "文案识别失败",
          });
        }
      }
      await worker.terminate();
    } catch {
      working = working.map((job) =>
        job.processedBlob
          ? {
              ...job,
              status: "error" as const,
              progress: 100,
              message: "文案识别组件加载失败，图片尺寸已处理",
            }
          : job,
      );
      jobsRef.current = working;
      setJobs([...working]);
    }

    setDuplicates(findDuplicateGroups(working));
    setProcessing(false);
  }

  async function chooseFolder() {
    if (processing) return;
    const pickerWindow = window as unknown as {
      showDirectoryPicker?: (options?: { mode?: "readwrite" }) => Promise<LocalDirectoryHandle>;
    };

    if (!pickerWindow.showDirectoryPicker) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const directory = await pickerWindow.showDirectoryPicker({ mode: "readwrite" });
      const selected: Array<{ file: File; handle: LocalFileHandle }> = [];
      let ignored = 0;

      for await (const entry of directory.values()) {
        if (entry.kind !== "file") {
          ignored += 1;
          continue;
        }
        const file = await entry.getFile();
        if (!SUPPORTED_TYPES.has(file.type)) {
          ignored += 1;
          continue;
        }
        selected.push({ file, handle: entry });
      }

      setIgnoredCount(ignored);
      setFolderMode(true);
      if (!selected.length) {
        setNotice("这个文件夹中没有可处理的 JPG、PNG 或 WebP 图片。");
        return;
      }
      await processFiles(selected);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNotice("无法读取这个文件夹，请确认已授予读写权限后重试。");
    }
  }

  async function handleFallbackFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files)
      .filter((file) => SUPPORTED_TYPES.has(file.type))
      .map((file) => ({ file }));
    setIgnoredCount(files.length - selected.length);
    setFolderMode(false);
    if (selected.length) await processFiles(selected);
  }

  useEffect(() => {
    const config = `${targetWidth}x${targetHeight}-${background}`;
    if (!jobs.length || processing || config === lastRenderedConfig.current) return;

    const timer = window.setTimeout(async () => {
      if (
        targetWidth < 1 ||
        targetHeight < 1 ||
        targetWidth > MAX_DIMENSION ||
        targetHeight > MAX_DIMENSION
      ) {
        return;
      }

      setProcessing(true);
      const working = [...jobsRef.current];
      for (let index = 0; index < working.length; index += 1) {
        const job = working[index];
        if (!job.file) continue;
        working[index] = { ...job, status: "resizing", progress: 12 };
        setJobs([...working]);
        try {
          const resized = await resizeImage(job.file, targetWidth, targetHeight, background);
          const oldResultUrl = job.resultUrl;
          working[index] = {
            ...job,
            processedBlob: resized.blob,
            resultUrl: URL.createObjectURL(resized.blob),
            status: "ready",
            progress: 100,
            message:
              job.ocrText || (job.confidence ?? 100) >= LOW_CONFIDENCE
                ? job.message
                : "建议人工检查",
          };
          if (oldResultUrl) URL.revokeObjectURL(oldResultUrl);
        } catch (error) {
          working[index] = {
            ...job,
            status: "error",
            progress: 100,
            message: error instanceof Error ? error.message : "重新生成图片失败",
          };
        }
        jobsRef.current = working;
        setJobs([...working]);
      }
      lastRenderedConfig.current = config;
      setProcessing(false);
    }, 320);

    return () => window.clearTimeout(timer);
  }, [background, jobs.length, processing, targetHeight, targetWidth]);

  async function saveResults() {
    setShowConfirm(false);
    let successCount = 0;
    const working = [...jobsRef.current];

    for (let index = 0; index < working.length; index += 1) {
      const job = working[index];
      if (!job.processedBlob) continue;
      working[index] = { ...job, status: "writing", message: undefined };
      setJobs([...working]);

      try {
        if (folderMode && job.handle) {
          const writable = await job.handle.createWritable();
          await writable.write(job.processedBlob);
          await writable.close();
        } else {
          const url = URL.createObjectURL(job.processedBlob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = job.file.name;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1200);
        }
        successCount += 1;
        working[index] = { ...job, status: "saved", progress: 100, message: undefined };
      } catch (error) {
        working[index] = {
          ...job,
          status: "error",
          progress: 100,
          message: error instanceof Error ? error.message : "保存失败，请重新授权",
        };
      }
      jobsRef.current = working;
      setJobs([...working]);
    }

    setNotice(
      folderMode
        ? `已将 ${successCount} 张图片按原文件名写回所选文件夹。`
        : `已下载 ${successCount} 张图片；浏览器可能会给同名文件添加序号。`,
    );
  }

  function requestSave() {
    if (duplicates.length) setShowConfirm(true);
    else void saveResults();
  }

  const readyToSave = jobs.some((job) => job.processedBlob) && !processing;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />

      <header className="hero">
        <div className="brand-line">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span>图准 · 本地图片工具</span>
        </div>
        <h1>
          尺寸统一，
          <span>重复文案一眼看见。</span>
        </h1>
        <p>
          选择一个图片文件夹，自动调整尺寸并检查本批图片中的相似文案。图片只在当前浏览器中处理。
        </p>
        <div className="privacy-note">
          <span className="privacy-dot" />
          不上传图片 · 不保存记录
        </div>
      </header>

      <section className="glass-rail" aria-label="图片处理设置">
        <div className="glass-shine" aria-hidden="true" />
        <div className="setting-group size-setting">
          <span className="setting-label">目标尺寸</span>
          <div className="segmented" role="group" aria-label="常用尺寸">
            <button
              className={sizeMode === "800" ? "active" : ""}
              onClick={() => updateMode("800")}
              type="button"
            >
              800 × 800
            </button>
            <button
              className={sizeMode === "1000" ? "active" : ""}
              onClick={() => updateMode("1000")}
              type="button"
            >
              1000 × 1000
            </button>
            <button
              className={sizeMode === "custom" ? "active" : ""}
              onClick={() => updateMode("custom")}
              type="button"
            >
              自定义
            </button>
          </div>
        </div>

        {sizeMode === "custom" && (
          <div className="custom-size" aria-label="自定义尺寸">
            <label>
              <span>宽</span>
              <input
                aria-label="目标宽度"
                min="1"
                max={MAX_DIMENSION}
                type="number"
                value={targetWidth}
                onChange={(event) =>
                  setTargetWidth(
                    Math.min(MAX_DIMENSION, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
            <span aria-hidden="true">×</span>
            <label>
              <span>高</span>
              <input
                aria-label="目标高度"
                min="1"
                max={MAX_DIMENSION}
                type="number"
                value={targetHeight}
                onChange={(event) =>
                  setTargetHeight(
                    Math.min(MAX_DIMENSION, Math.max(1, Number(event.target.value) || 1)),
                  )
                }
              />
            </label>
          </div>
        )}

        <label className="color-setting">
          <span className="setting-label">留白颜色</span>
          <span className="color-control">
            <input
              aria-label="留白背景颜色"
              type="color"
              value={background}
              onChange={(event) => setBackground(event.target.value)}
            />
            <span>{background.toUpperCase()}</span>
          </span>
        </label>

        <button
          className="primary-button"
          data-testid="choose-folder"
          disabled={processing}
          onClick={() => void chooseFolder()}
          type="button"
        >
          <span className="button-plus" aria-hidden="true">+</span>
          {processing ? "正在处理" : folderApiAvailable ? "选择图片文件夹" : "选择图片"}
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => void handleFallbackFiles(event.target.files)}
        />
      </section>

      {!folderApiAvailable && (
        <div className="browser-note" role="note">
          当前浏览器使用普通下载模式，无法保证同名文件直接覆盖。若需写回原文件夹，请使用电脑端 Chrome 或 Edge。
        </div>
      )}

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      {ignoredCount > 0 && (
        <p className="ignored-note">
          已跳过 {ignoredCount} 个不支持的文件或子文件夹；首版仅处理当前目录第一层的 JPG、PNG 和 WebP。
        </p>
      )}

      {!jobs.length ? (
        <section className="empty-workspace" aria-labelledby="empty-title">
          <div className="empty-copy">
            <span className="eyebrow">准备就绪</span>
            <h2 id="empty-title">从一个图片文件夹开始</h2>
            <p>处理完成前不会改动原文件。发现重复文案时，会先让你确认。</p>
            <button type="button" className="quiet-button" onClick={() => void chooseFolder()}>
              选择文件夹开始
              <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="sample-tiles" aria-hidden="true">
            <div className="sample-tile tile-back">
              <span>1000</span>
            </div>
            <div className="sample-tile tile-middle">
              <span>800</span>
            </div>
            <div className="sample-tile tile-front">
              <div className="mini-image" />
              <div className="mini-lines"><i /><i /><i /></div>
              <b>尺寸已统一</b>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="batch-summary" aria-label="处理进度">
            <div>
              <span className="eyebrow">本批图片</span>
              <h2>{jobs.length} 张图片</h2>
            </div>
            <div className="summary-stats">
              <span><b>{completedCount}</b> 已处理</span>
              <span className={duplicates.length ? "warning-stat" : ""}>
                <b>{duplicateFileCount}</b> 涉及重复
              </span>
              <span><b>{targetWidth} × {targetHeight}</b> 输出尺寸</span>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-label="整批处理进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overallProgress}
            >
              <i style={{ width: `${overallProgress}%` }} />
            </div>
          </section>

          {duplicates.length > 0 && (
            <section className="duplicate-panel" aria-labelledby="duplicate-title">
              <div className="duplicate-heading">
                <span className="warning-icon" aria-hidden="true">!</span>
                <div>
                  <span className="eyebrow">需要留意</span>
                  <h2 id="duplicate-title">发现 {duplicates.length} 组重复文案</h2>
                </div>
                <p>覆盖前会再次确认，不会自动跳过这些图片。</p>
              </div>
              <div className="duplicate-list">
                {duplicates.map((group) => (
                  <article className="duplicate-item" key={group.id}>
                    <div className="duplicate-meta">
                      <span>{group.kind}</span>
                      <b>{Math.round(group.similarity * 100)}%</b>
                    </div>
                    <div className="file-pair">
                      <span>{group.files[0]}</span>
                      <i aria-hidden="true">↔</i>
                      <span>{group.files[1]}</span>
                    </div>
                    <blockquote>“{group.snippet || "检测到相同文案"}”</blockquote>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="result-section" aria-labelledby="result-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">处理结果</span>
                <h2 id="result-title">图片预览</h2>
              </div>
              <p>图片完整保留，空余区域使用所选背景色。</p>
            </div>
            <div className="result-grid">
              {jobs.map((job) => (
                <article className="image-card" key={job.id}>
                  <div className="image-preview" style={{ backgroundColor: background }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={job.resultUrl ?? job.sourceUrl} alt={`${job.file.name} 处理预览`} />
                    {job.status === "ocr" && (
                      <span className="scan-line" aria-hidden="true" />
                    )}
                  </div>
                  <div className="card-body">
                    <div className="file-title-row">
                      <h3 title={job.file.name}>{job.file.name}</h3>
                      <span className={`status-chip status-${job.status}`}>
                        {statusLabel(job)}
                      </span>
                    </div>
                    <div className="dimension-row">
                      <span>
                        {job.originalWidth && job.originalHeight
                          ? `${job.originalWidth} × ${job.originalHeight}`
                          : "读取中"}
                      </span>
                      <i aria-hidden="true">→</i>
                      <b>{targetWidth} × {targetHeight}</b>
                    </div>
                    {job.message && <p className="job-message">{job.message}</p>}
                    {job.ocrText && (
                      <p className="ocr-preview" title={job.ocrText}>
                        {job.ocrText.replace(/\s+/g, " ").slice(0, 72)}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="save-rail" aria-label="保存处理结果">
            <div>
              <span className="save-dot" />
              <p>
                <b>{folderMode ? "将写回所选文件夹" : "将下载处理结果"}</b>
                <span>
                  {folderMode
                    ? "保留原文件名，确认后覆盖原图"
                    : "浏览器可能会为同名文件添加序号"}
                </span>
              </p>
            </div>
            <button
              className="save-button"
              data-testid="save-results"
              disabled={!readyToSave}
              onClick={requestSave}
              type="button"
            >
              {processing ? "处理进行中" : folderMode ? "覆盖原图" : "下载处理结果"}
              <span aria-hidden="true">↓</span>
            </button>
          </section>
        </>
      )}

      <footer>
        <span>图准</span>
        <p>本地处理 · 简体中文与英文 OCR · 支持 JPG / PNG / WebP</p>
      </footer>

      {showConfirm && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <span className="modal-warning" aria-hidden="true">!</span>
            <span className="eyebrow">覆盖前确认</span>
            <h2 id="confirm-title">仍有 {duplicates.length} 组重复文案</h2>
            <p>
              涉及 {duplicateFileCount} 张图片。继续后会按当前尺寸处理并保留原文件名，重复图片不会自动跳过。
            </p>
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setShowConfirm(false)}>
                返回检查
              </button>
              <button type="button" className="modal-confirm" onClick={() => void saveResults()}>
                {folderMode ? "仍然覆盖" : "仍然下载"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
