// Extract and sanitise model-written SVG / HTML.
function extractSvg(text) {
  const m = String(text).match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new Error('Model did not return an <svg>');
  return sanitizeSvg(m[0]);
}
function sanitizeSvg(svg) {
  let s = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(https?:|javascript:)[^"']*\2/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  if (!/xmlns=/.test(s)) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}
function extractHtml(text) {
  const s = String(text);
  const fenced = s.match(/```html\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : s;
  const a = body.search(/<!DOCTYPE html|<html/i);
  const b = body.toLowerCase().lastIndexOf('</html>');
  if (a >= 0 && b > a) body = body.slice(a, b + 7);
  else if (a >= 0) body = body.slice(a) + '\n</html>';
  if (!/<html|<body|<canvas|<script/i.test(body)) throw new Error('Model did not return HTML');
  return body.trim();
}
const svgDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
module.exports = { extractSvg, sanitizeSvg, extractHtml, svgDataUri };
