"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { basePath } from "@/lib/base-path";

/**
 * Transição "igual à do WhatsApp" (skill deslizar-entre-telas), adaptada ao
 * Next.js: abrir um detalhe (nota, remédio, novo registro, edição) faz a tela
 * nova entrar pela direita por cima da lista, que recua um pouco e escurece;
 * voltar (seta do app ou voltar do celular) faz o caminho inverso.
 *
 * Diferença em relação à receita em HTML puro: lá a tela nova é animada no
 * lugar. Aqui o cabeçalho, o menu inferior e o botão redondo são `fixed`, e
 * animar a página os faria pular. Então, por ~0,3 s, animam-se duas CÓPIAS
 * paradas (a tela que sai, tirada no toque, e a que entra, tirada assim que
 * desenhada), com a tela de verdade escondida por baixo.
 */

const ROOT_ID = "tela";
const DURATION_MS = 600; // limpeza por tempo (a animação dura 0,3 s)
const PENDING_MAX_MS = 2000; // toque que não virou navegação (ex.: confirmação cancelada)

/** Profundidade de cada tela: maior = mais "dentro". Abas = 0. */
function depthOf(path: string): number | null {
  const p = path.endsWith("/") ? path : `${path}/`;
  if (p === "/" || p === "/medicamentos/" || p === "/pressao/" || p === "/ajustes/") return 0;
  if (p === "/registro/" || p === "/medicamentos/detalhe/" || p === "/gravar/") return 1;
  if (p === "/medicamentos/editar/") return 2;
  return null; // ex.: /entrar/: não anima
}

/** "/klin/registro/" -> "/registro/" (o usePathname já vem sem o basePath). */
function appPath(pathname: string): string {
  return basePath && pathname.startsWith(basePath) ? pathname.slice(basePath.length) || "/" : pathname;
}

function directionOf(from: string, to: string): "frente" | "volta" | null {
  const a = depthOf(from);
  const b = depthOf(to);
  if (a === null || b === null || a === b) return null;
  return b > a ? "frente" : "volta";
}

/** Cópia parada da tela: sem ids (a tela nova acharia a cópia), sem foco, invisível a leitores. */
function snapshot(root: HTMLElement, scrollY: number, alreadyCopied = false): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "tela-copia";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  const copy = alreadyCopied ? root : (root.cloneNode(true) as HTMLElement);
  copy.removeAttribute("id");
  copy.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  copy.style.position = "absolute";
  copy.style.left = "0";
  copy.style.right = "0";
  copy.style.top = `${-scrollY}px`;
  // O cabeçalho é "sticky": na cópia (que não rola) ele ficaria fora da tela.
  const header = copy.querySelector("header");
  if (header) (header as HTMLElement).style.transform = `translateY(${scrollY}px)`;
  layer.append(copy);
  return layer;
}

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function NavTransition() {
  const pathname = usePathname() ?? "/";
  const search = useSearchParams()?.toString() ?? "";
  const route = `${pathname}?${search}`;
  const lastPath = useRef(pathname);
  const pending = useRef<{ dir: "frente" | "volta"; old: HTMLElement; at: number } | null>(null);
  const firstRender = useRef(true);

  // 1) No toque num link ou no voltar do celular: tira a cópia da tela que SAI,
  //    antes de o Next trocar a página (ele troca depois, num passo do React).
  useEffect(() => {
    function prepare(toPath: string) {
      pending.current = null;
      if (reduceMotion()) return;
      const dir = directionOf(lastPath.current, toPath);
      const root = document.getElementById(ROOT_ID);
      if (!dir || !root) return;
      pending.current = { dir, old: snapshot(root, window.scrollY), at: Date.now() };
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented && !(e.target as Element)?.closest?.("a")) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      prepare(appPath(url.pathname));
    }
    // Voltar do celular: a cópia é tirada pelo NAV_POP_SCRIPT (no <head>),
    // porque o Next troca a tela antes de um ouvinte registrado aqui rodar.

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // 2) A tela nova foi desenhada (antes de pintar): monta as duas cópias e anima.
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      lastPath.current = pathname;
      return;
    }
    const from = lastPath.current;
    lastPath.current = pathname;
    let p = pending.current;
    pending.current = null;
    const pop = (window as { __klinPop?: { el: HTMLElement; y: number; at: number } }).__klinPop;
    delete (window as { __klinPop?: unknown }).__klinPop;
    if (pop && Date.now() - pop.at < PENDING_MAX_MS && !reduceMotion()) {
      const dir = directionOf(from, pathname);
      if (dir) p = { dir, old: snapshot(pop.el, pop.y, true), at: pop.at };
    }
    if (!p || Date.now() - p.at > PENDING_MAX_MS || from === pathname) return;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const incoming = snapshot(root, window.scrollY);
    const outgoing = p.old;
    const stage = document.createElement("div");
    stage.className = `tela-transicao ${p.dir}`;
    stage.setAttribute("aria-hidden", "true");
    if (p.dir === "frente") {
      outgoing.classList.add("tela-recua");
      incoming.classList.add("tela-entra-dir");
      stage.append(outgoing, incoming); // a nova por cima
    } else {
      incoming.classList.add("tela-volta");
      outgoing.classList.add("tela-sai-dir");
      stage.append(incoming, outgoing); // a que sai por cima
    }
    document.body.append(stage);
    root.style.visibility = "hidden";

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stage.remove();
      root.style.visibility = "";
    };
    (p.dir === "frente" ? incoming : outgoing).addEventListener("animationend", finish, { once: true });
    const timer = window.setTimeout(finish, DURATION_MS); // alguns navegadores não avisam o fim
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [route, pathname]);

  return null;
}
