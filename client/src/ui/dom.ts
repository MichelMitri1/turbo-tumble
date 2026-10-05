/** Tiny DOM helper: el('div', 'class names', children | text). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  content?: string | Array<Node | string>,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else if (content) node.append(...content);
  return node;
}
