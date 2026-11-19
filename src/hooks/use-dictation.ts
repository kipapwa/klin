"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Ditado: reconhecimento de voz do próprio navegador (Web Speech API).
 * O texto aparece enquanto a pessoa fala. O áudio vai para o serviço de voz
 * do sistema (Google no Android/Chrome, Apple no iPhone) — não para o
 * Gemini/Groq. Onde não existe, `supported` é false e o botão some.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribeNothing = () => () => {};
const isAndroid = () => /android/i.test(navigator.userAgent);

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o uso do microfone para ditar (configurações do navegador).",
  "service-not-allowed": "O ditado não está liberado neste navegador.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "O ditado precisa de internet.",
  "language-not-supported": "Ditado em português não disponível neste aparelho.",
};

export function useDictation(onFinal: (text: string) => void) {
  const supported = useSyncExternalStore(subscribeNothing, () => Boolean(recognitionCtor()), () => false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false); // a pessoa ainda quer ditar (religa após pausas)
  const onFinalRef = useRef(onFinal);

  useEffect(() => {
    onFinalRef.current = onFinal;
  });

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    setError(null);
    const rec = new Ctor();
    rec.lang = "pt-BR";
    // No Android o modo contínuo repete frases: lá, uma frase por vez (e religa).
    rec.continuous = !isAndroid();
    rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onFinalRef.current(r[0].transcript);
        else partial += r[0].transcript;
      }
      setInterim(partial);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // pausa: religa no onend
      wantRef.current = false;
      setError(ERRORS[e.error] ?? "O ditado parou. Toque no microfone para continuar.");
    };
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start(); // o navegador encerra sozinho após um silêncio
          return;
        } catch {
          wantRef.current = false;
        }
      }
      recRef.current = null;
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      setError("Não foi possível iniciar o ditado.");
    }
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop(); // entrega o último trecho antes de encerrar
  }, []);

  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  return { supported, listening, interim, error, start, stop };
}
