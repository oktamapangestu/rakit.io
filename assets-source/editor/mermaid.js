// Mermaid (dimuat dari CDN saat pertama dipakai) dengan tema yang mengikuti tema editor. Dipakai tab Diagram dan
// diagram alur di Baca Alur Kode.
export const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs';
let loaded = null;
let loadedDark = null;

export async function loadMermaid(dark) {
  if (loaded && loadedDark === dark) return loaded;
  const mermaid = loaded ?? (await import(MERMAID_URL)).default;
  loadedDark = dark;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: 'Inter, -apple-system, "Segoe UI", system-ui, sans-serif',
    themeVariables: dark ? {
      darkMode: true,
      background: '#11151f',
      primaryColor: '#1b2130',
      primaryTextColor: '#f5f7fb',
      primaryBorderColor: '#16a34a',
      secondaryColor: '#161b27',
      tertiaryColor: '#161b27',
      lineColor: '#7c869b',
      textColor: '#d8dde8',
      fontSize: '14px',
      attributeBackgroundColorOdd: '#161b27',
      attributeBackgroundColorEven: '#11151f',
      edgeLabelBackground: '#11151f',
    } : {
      darkMode: false,
      background: '#fffdf7',
      primaryColor: '#fff8e7',
      primaryTextColor: '#1a1320',
      primaryBorderColor: '#d6a01e',
      secondaryColor: '#fbf2dc',
      tertiaryColor: '#fbf2dc',
      lineColor: '#8a8274',
      textColor: '#2b2330',
      fontSize: '14px',
      attributeBackgroundColorOdd: '#fbf2dc',
      attributeBackgroundColorEven: '#fffdf7',
      edgeLabelBackground: '#fffdf7',
      actorBkg: '#fff8e7',
      actorBorder: '#d6a01e',
      noteBkgColor: '#ffe9b0',
      noteBorderColor: '#d6a01e',
    },
    er: { useMaxWidth: false },
    flowchart: { useMaxWidth: false, curve: 'basis', htmlLabels: false },
  });
  loaded = mermaid;
  return mermaid;
}
