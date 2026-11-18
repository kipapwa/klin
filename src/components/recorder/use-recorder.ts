"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SECONDS, pickRecorderMime, RECORDER_BITS_PER_SECOND } from "@/lib/audio";

export type RecorderState =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording"; seconds: number }
  | { kind: "recorded"; blob: Blob; url: string; seconds: number }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permita o acesso ao microfone nas configurações do navegador para gravar.";
  }
  if (name === "NotFoundError") return "Nenhum microfone encontrado neste aparelho.";
  if (name === "NotReadableError") return "O microfone está em uso por outro aplicativo.";
  return "Não foi possível iniciar a gravação.";
}

/** Gravação de áudio com MediaRecorder: iniciar, parar, descartar. */
export function useRecorder() {
  // Sempre "idle" no início (igual no build estático e no navegador);
  // a falta de suporte é detectada ao tocar em gravar.
  const [state, setState] = useState<RecorderState>({ kind: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const startedAtRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  const releaseDevices = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "unsupported" });
      return;
    }
    setState({ kind: "requesting" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setState({ kind: "error", message: micErrorMessage(err) });
      return;
    }
    streamRef.current = stream;

    const mimeType = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: RECORDER_BITS_PER_SECOND,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
      releaseDevices();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setState({ kind: "recorded", blob, url: urlRef.current, seconds });
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start(1000);
    setState({ kind: "recording", seconds: 0 });

    // Mantém a tela acesa durante gravações longas (quando o navegador permite).
    navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        wakeLockRef.current = lock;
      })
      .catch(() => {});
  }, [releaseDevices]);

  const reset = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setState({ kind: "idle" });
  }, []);

  // Cronômetro e limite máximo de duração.
  const recording = state.kind === "recording";
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000;
      if (seconds >= MAX_RECORDING_SECONDS) stop();
      else setState({ kind: "recording", seconds });
    }, 250);
    return () => clearInterval(timer);
  }, [recording, stop]);

  // Ao sair da tela: libera microfone e memória.
  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      }
      releaseDevices();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [releaseDevices],
  );

  return { state, start, stop, reset };
}
