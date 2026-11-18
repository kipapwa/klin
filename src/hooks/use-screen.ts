"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readScreen, sameData, writeScreen } from "@/lib/screen-cache";
import { UserFacingError } from "@/lib/records";

export interface ScreenState<T> {
  /** Dados para desenhar: o guardado na hora, o do banco quando chegar. */
  data: T | undefined;
  /** Erro da última busca (com dados guardados, a tela continua desenhada). */
  error: string | null;
  /** true enquanto não há nada para mostrar (nem guardado). */
  loading: boolean;
  /** Busca de novo no banco. */
  refresh: () => Promise<void>;
  /** Já sei o resultado (ex.: depois de salvar): redesenha e guarda sem esperar o banco. */
  update: (data: T) => void;
}

/**
 * Tela instantânea: desenha com o guardado (ou com `seed`, ex.: o item vindo
 * da lista) e troca pelo banco só se vier diferente.
 *
 * `name` identifica a tela (troca de tela = troca de nome). `store: false` =
 * não guarda no aparelho (ex.: busca com filtros, cujo termo é dado de saúde).
 * `guard` = formulário: depois de a pessoa mexer (`touch()`), o banco não
 * troca mais nada.
 */
export function useScreen<T>(
  name: string,
  fetcher: () => Promise<T>,
  opts: { seed?: T; guard?: boolean; store?: boolean } = {},
): ScreenState<T> & { touch: () => void } {
  const store = opts.store !== false;
  const cached = () => (store ? readScreen<T>(name) : undefined) ?? opts.seed;
  const [state, setState] = useState<{ name: string; data: T | undefined; error: string | null }>(() => ({
    name,
    data: cached(),
    error: null,
  }));
  const fetcherRef = useRef(fetcher);
  const touched = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  // Trocou de tela (outro id/filtro): recomeça já com o guardado da nova.
  if (state.name !== name) {
    setState({ name, data: cached(), error: null });
  }

  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const fresh = await fetcherRef.current();
      if (gen !== generation.current) return; // resposta antiga: outra busca já começou
      if (store) writeScreen(name, fresh);
      if (opts.guard && touched.current) return;
      setState((s) => (sameData(s.data, fresh) && s.error === null ? s : { name, data: fresh, error: null }));
    } catch (err) {
      if (gen !== generation.current) return;
      const message = err instanceof UserFacingError ? err.message : "Não foi possível carregar.";
      setState((s) => ({ ...s, error: message }));
    }
  }, [name, opts.guard, store]);

  useEffect(() => {
    void refresh();
    return () => {
      // Saiu da tela: invalida a resposta que ainda vai chegar. É um contador (não um nó
      // do React), então ler o valor atual aqui é exatamente o que se quer.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, [refresh]);

  const update = useCallback(
    (data: T) => {
      if (store) writeScreen(name, data);
      setState({ name, data, error: null });
    },
    [name, store],
  );

  return {
    data: state.data,
    error: state.error,
    loading: state.data === undefined && state.error === null,
    refresh,
    update,
    touch: () => {
      touched.current = true;
    },
  };
}
