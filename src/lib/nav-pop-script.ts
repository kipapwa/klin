/**
 * Voltar do celular (popstate) para a transição entre telas.
 *
 * O Next registra o próprio ouvinte de popstate ao carregar e troca a tela
 * NA HORA. Este script vai no <head> e roda antes do Next, então é o primeiro
 * a ouvir o voltar: tira a cópia da tela que SAI enquanto ela ainda está lá.
 * O componente NavTransition usa a cópia quando a tela nova for desenhada.
 *
 * Texto fixo (sem dado do usuário), por isso pode ir como script inline.
 */
export const NAV_POP_SCRIPT = `window.addEventListener("popstate",function(){try{var r=document.getElementById("tela");if(r)window.__klinPop={el:r.cloneNode(true),y:window.scrollY,at:Date.now()}}catch(e){}},true);`;
