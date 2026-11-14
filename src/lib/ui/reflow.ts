/**
 * Fuerza al navegador a calcular el estilo y el layout de un elemento YA, para
 * que una transición arranque desde el valor que se acaba de escribir.
 *
 * Vive en su propio módulo a propósito: escrito como `void el.offsetWidth`
 * adentro de un componente, el React Compiler lo toma como una lectura sin
 * efecto y lo BORRA (pasó con la lupa de la barra: viajaba desde el destino).
 * Una llamada a otro módulo no la puede sacar.
 */
export function reflow(el: Element): number {
  return el.getBoundingClientRect().width;
}
