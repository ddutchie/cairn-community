/**
 * SVG sanitizer -- allowlist-based, for connector logos.
 *
 * Logos are compiled INTO manifest.json and rendered inline by the Cairn apps,
 * so a hostile logo (script, event handler, external ref, foreignObject) would
 * be an injection vector. Sanitizing here at build/CI time means the client
 * never has to trust or sanitize logo markup at runtime -- the shipped manifest
 * is already clean.
 *
 * Strategy: reject anything not on the allowlist rather than try to strip it.
 * A logo that can't pass is a build failure, not a silently-mangled icon.
 *
 * Shared by build-manifest.mjs (compile) and validate.mjs (CI gate). No deps.
 */

// Elements a flat, single-color brand glyph needs -- nothing that can execute,
// navigate, or embed foreign content.
const ALLOWED_ELEMENTS = new Set([
  "svg", "path", "g", "circle", "rect", "line", "polygon", "polyline",
  "ellipse", "defs", "lineargradient", "radialgradient", "stop", "title", "desc",
]);

// Attributes allowed on any element (geometry + presentation only).
const ALLOWED_ATTRS = new Set([
  "viewbox", "xmlns", "width", "height", "fill", "fill-rule", "fill-opacity",
  "clip-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-opacity", "opacity", "d",
  "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "points",
  "transform", "offset", "stop-color", "stop-opacity", "gradientunits",
  "gradienttransform", "role", "aria-hidden",
  // `id`/`class` allowed but scrubbed of nothing dangerous themselves;
  // gradient refs use `id` + `fill="url(#id)"` (url() is validated below).
  "id", "class",
]);

/** Throws with a specific reason if the SVG is unsafe; returns nothing. */
export function assertSafeSvg(svg, label = "svg") {
  if (typeof svg !== "string" || !svg.trim()) {
    throw new Error(`${label}: empty SVG`);
  }
  const s = svg.trim();
  if (!/^<svg[\s>]/i.test(s)) throw new Error(`${label}: must start with <svg>`);

  // Fast reject of the obvious dangerous constructs anywhere in the string.
  const banned = [
    [/<script/i, "<script>"],
    [/<foreignobject/i, "<foreignObject>"],
    [/<(image|use|iframe|embed|object|animate|set|a)\b/i, "disallowed element"],
    [/\son\w+\s*=/i, "inline event handler (on*)"],
    [/javascript:/i, "javascript: URI"],
    [/data:(?!image\/)/i, "non-image data: URI"],
    [/<!entity|<!doctype|<!\[cdata/i, "DOCTYPE/ENTITY/CDATA"],
    [/xlink:href|(?<![-\w])href\s*=/i, "href / xlink:href"],
  ];
  for (const [re, why] of banned) {
    if (re.test(s)) throw new Error(`${label}: contains ${why}`);
  }

  // Element allowlist: every tag name must be known-safe.
  for (const m of s.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g)) {
    const tag = m[1].toLowerCase();
    if (!ALLOWED_ELEMENTS.has(tag)) throw new Error(`${label}: disallowed element <${tag}>`);
  }

  // Attribute allowlist across all tags.
  for (const m of s.matchAll(/\s([a-zA-Z_:][\w:.-]*)\s*=/g)) {
    const attr = m[1].toLowerCase();
    if (!ALLOWED_ATTRS.has(attr)) throw new Error(`${label}: disallowed attribute "${attr}"`);
  }

  // url(...) may only reference a local gradient (#id), never a remote resource.
  for (const m of s.matchAll(/url\(\s*([^)]*)\)/gi)) {
    const ref = m[1].replace(/['"]/g, "").trim();
    if (!ref.startsWith("#")) throw new Error(`${label}: url() must be a local #ref, got "${ref}"`);
  }
}

/**
 * Normalize a Simple Icons (or any) SVG to a tintable glyph:
 * drop <title>/<desc>/role, force fill="currentColor". Validates first.
 */
export function normalizeSvg(svg, label = "svg") {
  assertSafeSvg(svg, label);
  const out = svg
    .replace(/<title>.*?<\/title>/gis, "")
    .replace(/<desc>.*?<\/desc>/gis, "")
    .replace(/\s(role|aria-hidden)="[^"]*"/gi, "")
    .replace(/\sfill="(?!none)[^"]*"/gi, "") // drop hardcoded fills (keep fill="none")
    .replace(/<svg\b/i, '<svg fill="currentColor"')
    .replace(/\s{2,}/g, " ")
    .trim();
  assertSafeSvg(out, label); // re-validate after transform
  return out;
}
