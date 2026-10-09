// "baris 12" / "baris 12–20" (versi Inggris: "line 12" / "lines 12–20") di jawaban AI → tombol yang memanggil
// onLine(awal, akhir) untuk menyorot baris itu. Mengubah root di tempat dan mengembalikannya.
export function linkifyLines(root, onLine) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = node.textContent.split(/((?:baris|lines?)\s+\d+(?:\s*[-–]\s*\d+)?)/gi);
    if (parts.length < 2) continue;
    node.replaceWith(...parts.map((part) => {
      const m = part.match(/^(?:baris|lines?)\s+(\d+)(?:\s*[-–]\s*(\d+))?$/i);
      if (!m) return part;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flow-line-link';
      btn.textContent = part;
      btn.addEventListener('click', () => onLine(Number(m[1]), Number(m[2] || m[1])));
      return btn;
    }));
  }
  return root;
}
