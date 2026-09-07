import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const doc = await getDocument({ url: process.argv[2], useSystemFonts: true }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const c = await page.getTextContent();
  let last = null, line = '';
  for (const it of c.items) {
    const y = Math.round(it.transform[5]);
    if (last !== null && Math.abs(y - last) > 2) { console.log(line.trim()); line = ''; }
    line += it.str; last = y;
  }
  console.log(line.trim());
  console.log('--- end page ' + p + ' ---');
}
