---
name: tela-instantanea
description: Regras para toda tela nova (ou mudada) do Klin abrir na hora, sem esperar o banco. Use sempre que criar ou alterar uma tela, lista, detalhe, formulário ou o sininho em src/components ou src/app.
---

# Tela instantânea (Klin, React)

Premissa do usuário: **ao tocar num ícone ou link, a tela abre na hora**. Toda tela que busca dados no
banco desenha primeiro com o que ficou guardado da última vez e só redesenha se o banco trouxer algo
diferente. O teste `telas instantâneas` em `e2e/flow.mjs` (banco atrasado 4 s, tela em até 1 s)
reprova a tela que esquecer isso — acrescente nele toda tela nova.

## Como fazer

**Lista ou detalhe** — `useScreen(nome, buscar, opções)` (`src/hooks/use-screen.ts`):

```tsx
const screen = useScreen("remedios", listMedications);
if (screen.loading) return <Spinner />;           // só quando não há nada guardado
if (!screen.data) return <p role="alert">{screen.error}</p>;
// desenha screen.data; screen.refresh() busca de novo
```

- Nome por tela; para um item, `"coisa:<id>"` (ex.: `registro:<id>`, `remedio:<id>`).
- Detalhe que vem de uma lista: passe `seed` com o item já guardado na lista
  (`readScreen("remedios")?.find(...)`), como em `medication-detail.tsx` e `record-view.tsx`.
- Telas que compartilham dados usam o mesmo nome (o sininho e a tela de remédios usam `"remedios"`).

**Formulário** — `useScreen(..., { guard: true })` e o `<Form>` guarda os próprios valores
(`useState(initial)`): o que o banco trouxer depois não apaga o que a pessoa digitou.

**Busca com filtros** — `store: false` (o termo buscado é dado de saúde e não vai para o nome da
chave) e `seed` com a lista completa guardada filtrada no aparelho (`filterLocally` em
`record-list.tsx`).

**Pedaços que chegam depois** (estado do push, biometria): desenhe a tela inteira na hora e mostre
"…" só no valor que falta.

**Tela muito usada:** acrescente em `prefetchScreens(...)` na `timeline-screen.tsx`.

## Depois de mudar dados

- Já sabe o resultado: `screen.update(dados)` (ex.: perfil em Ajustes). Não espere o banco.
- Doses e remédios: as funções de `src/lib/medications.ts` disparam `DOSES_CHANGED`; telas que
  mostram remédios escutam e chamam `refresh()`.
- Apagou um item: `forgetScreen("coisa:<id>")` (e a lista, se for o caso).

## Segurança e privacidade

- Guardado = memória + localStorage DESTE aparelho, separado por conta
  (`klin:tela:<usuário>:<nome>`), apagado ao sair (`forgetUserScreens`, chamado em `useSignOut`, no
  "Esqueci o PIN" e após erros demais no PIN).
- Contém dados clínicos do próprio usuário: mesma proteção da sessão de login, que já fica no mesmo
  armazenamento. Nunca guarde dados de outra pessoa.
- As permissões continuam no banco (RLS): o guardado nunca libera nada.
- Nada clínico no NOME da chave (por isso `store: false` nas buscas).
