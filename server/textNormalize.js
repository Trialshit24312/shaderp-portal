/** Fix mojibake and normalize changelog text from PowerShell / mixed encodings. */
export function normalizeChangelogText(text) {
  if (!text || typeof text !== 'string') return '';

  let s = text.replace(/\r\n/g, '\n');
  s = s.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');

  const pairs = [
    [/\u00c2\u00b7/g, '·'],
    [/Â·/g, '·'],
    [/\u00e2\u0080\u0094/g, '—'],
    [/\u00e2\u0080\u0093/g, '–'],
    [/â€"/g, '—'],
    [/â€“/g, '–'],
    [/â€"/g, '—'],
    [/\u00e2\u0086\u0092/g, '→'],
    [/â†'/g, '→'],
    [/â†'/g, '→'],
    [/\u00e2\u0080\u009c/g, '"'],
    [/\u00e2\u0080\u009d/g, '"'],
    [/â€œ/g, '"'],
    [/â€\u009d/g, '"'],
    [/â€\u009c/g, '"'],
    [/\u00e2\u0080\u0098/g, "'"],
    [/\u00e2\u0080\u0099/g, "'"],
    [/â€˜/g, "'"],
    [/â€™/g, "'"],
    [/â€¦/g, '…'],
    [/Ã©/g, 'é'],
    [/Ã¨/g, 'è'],
    [/Ã /g, 'à'],
    [/â€"/g, '—'],
    [/â€"/g, '—'],
  ];

  for (const [re, rep] of pairs) s = s.replace(re, rep);

  return s.replace(/[ \t]+\n/g, '\n').trim();
}

export function sanitizeUpdatePass(pass) {
  if (!pass || typeof pass !== 'object') return pass;
  return {
    ...pass,
    title: normalizeChangelogText(pass.title || ''),
    overview: normalizeChangelogText(pass.overview || ''),
    body: normalizeChangelogText(pass.body || ''),
    subtitle: normalizeChangelogText(pass.subtitle || ''),
    date: normalizeChangelogText(pass.date || ''),
  };
}
