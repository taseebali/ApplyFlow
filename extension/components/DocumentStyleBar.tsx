import {
  DEFAULT_STYLE,
  FONTS,
  LINE_HEIGHTS,
  MARGINS,
  SIZES,
  type DocumentStyle,
} from '@/lib/document-style';

/**
 * How the document is set, above the document.
 *
 * The four settings that decide whether a resume fits on a page, and the only
 * four a resume needs. There is deliberately no bold, italic or colour here:
 * a resume's emphasis is structural — the name, the section rules, the entry
 * titles — and the template already applies it consistently. A per-word bold
 * button would let the document drift out of step with itself, and the .docx
 * export is built from plain strings, so it could not carry the formatting to
 * the file anyway. Typeface, size, leading and margins do reach the file.
 *
 * Margin is the strongest of the four. Going from 1" to 0.6" adds 76px of
 * room — three or four bullet lines — and the one-page rule redraws as soon as
 * it changes.
 */
export function DocumentStyleBar({
  style,
  onChange,
}: {
  style: DocumentStyle;
  onChange: (style: DocumentStyle) => void;
}) {
  const set = <K extends keyof DocumentStyle>(key: K, value: DocumentStyle[K]) =>
    onChange({ ...style, [key]: value });

  const isDefault =
    style.font === DEFAULT_STYLE.font &&
    style.size === DEFAULT_STYLE.size &&
    style.line === DEFAULT_STYLE.line &&
    style.margin === DEFAULT_STYLE.margin;

  return (
    <div className="doc-style">
      <select
        className="doc-style-item doc-style-font"
        aria-label="Typeface"
        value={style.font}
        onChange={(e) => set('font', e.target.value)}
      >
        {FONTS.map((font) => (
          <option key={font.name} value={font.name} style={{ fontFamily: font.stack }}>
            {font.name}
          </option>
        ))}
      </select>

      <select
        className="doc-style-item"
        aria-label="Text size, in points"
        value={style.size}
        onChange={(e) => set('size', Number(e.target.value))}
      >
        {SIZES.map((size) => (
          <option key={size} value={size}>
            {size} pt
          </option>
        ))}
      </select>

      <select
        className="doc-style-item"
        aria-label="Line spacing"
        value={style.line}
        onChange={(e) => set('line', Number(e.target.value))}
      >
        {LINE_HEIGHTS.map((line) => (
          <option key={line} value={line}>
            {line.toFixed(2).replace(/0$/, '')} ×
          </option>
        ))}
      </select>

      <select
        className="doc-style-item"
        aria-label="Page margin"
        title="Page margin. The quickest way to win a line."
        value={style.margin}
        onChange={(e) => set('margin', Number(e.target.value))}
      >
        {MARGINS.map((margin) => (
          <option key={margin} value={margin}>
            {margin}&quot; margin
          </option>
        ))}
      </select>

      <button
        type="button"
        className="doc-style-reset"
        disabled={isDefault}
        onClick={() => onChange(DEFAULT_STYLE)}
      >
        Reset
      </button>
    </div>
  );
}
